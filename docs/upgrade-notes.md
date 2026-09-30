# Upgrading to the next release

What an environment running the previous release needs, in order, when this
release is deployed. Do everything on **staging** (`glitter-finance-staging`,
its PowerSync instance and the Vercel environment that serves it) first, run
the acceptance checks at the end, and only then repeat the same steps on
**production** (`glitter-finance`).

Once every environment has had these steps, keep what still applies in the
README and empty this file for the release after.

## What changes for operators

| Area                  | Change                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App environment       | The server now checks at startup that the required variables, `INVITATION_SECRET_KEY` included, are set. Browser Sentry reports only from Vercel production and preview deployments.                                                                                                                                                 |
| Product categories    | Each puesto now keeps its own categories (a new `categories` table), and a product must be filed under one of them. A puesto's existing product categories become its categories the first time it opens the app.                                                                                                                    |
| Database schema       | Two Drizzle migrations: the `categories` table, then stricter `CHECK` constraints (they fail on rows that break them), a zero `initial` stock count allowed, index changes, text length caps and per-field edit times.                                                                                                               |
| Hand-written SQL      | Seven new `supabase/manual/` files: categories RLS, category rename and delete triggers, categories in the PowerSync publication, upload timestamp bounds and void/refund convergence, Storage limits and policies for product images, per-field last-write-wins product edits, and category renames that win over those edit times. |
| PowerSync             | The sync streams add `categories` and also require a `tenant_users` membership, so they must be redeployed once `categories` is published.                                                                                                                                                                                           |
| Supabase Auth         | Minimum password length 8, and new confirmation and password recovery email templates that link to `/auth/confirm`.                                                                                                                                                                                                                  |
| Response headers, PWA | App-wide security headers, a manifest with a stable `id` and maskable icons, product photos cached offline, and an offline page.                                                                                                                                                                                                     |
| Tooling (developers)  | A pnpm catalog, TypeScript 6.0 (the newest typescript-eslint supports), Supabase CLI 2.115.0 or later, and CI checks on every pull request.                                                                                                                                                                                          |

## Once, before the first environment

### Developer machines

1. Pull, then run `pnpm install`. The lockfile changed, and TypeScript moves
   from 7.0 back to 6.0 so ESLint can load it.
2. Install or upgrade the Supabase CLI to **2.115.0 or later**
   (`brew upgrade supabase`). The `pnpm db:*` scripts refuse older or missing
   CLIs.
3. Make sure `.env.local` has `INVITATION_SECRET_KEY`. The server no longer
   starts without it. If it is already set, keep it; if not, add any long
   random string (for example `openssl rand -base64 32`).
4. Restart the local stack so it picks up the `supabase/config.toml` changes
   (password length 8, the confirmation and recovery templates, the manual SQL
   in `db reset`): `pnpm db:stop && pnpm db:start`, then `pnpm db:reset`. The
   reset now runs every `supabase/manual/` file before `seed.sql`, which also
   confirms that the CLI accepts them. It wipes local data.
5. Optional: to run `pnpm test:db`, install the PostgreSQL server binaries
   (`brew install postgresql@17`) or set `PG_BIN`.

### GitHub

Optional: in the branch protection rules for `main`, `develop` and `staging`,
require the **Typecheck, lint, test, format** check that
`.github/workflows/ci.yml` now runs.

## Per environment (staging, then production)

### 1. Vercel project settings and variables

In the Vercel environment that serves this Supabase project (Preview for
staging, Production for production, and Development too if anyone runs
`vercel dev`):

1. Confirm that all five required server variables are set:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `INVITATION_SECRET_KEY` and `DATABASE_URL`. The
   server now refuses to start without any of them, and `/api/health` fails
   too.

   `INVITATION_SECRET_KEY` is not new: invitations already needed it, so it
   is set wherever they have been used. **If it is set, keep the existing
   value.** Changing it invalidates every open invitation link: `/join/<token>`
   links already shared with helpers stop working, and the **Equipo** card
   quietly revokes its link and shows a new one. Only if it is missing,
   generate one for this environment alone (`openssl rand -base64 32`). If
   staging and production share a value, give only staging a new one, and
   expect staging's open links to break.

2. Keep **Settings → Environment Variables → Automatically expose System
   Environment Variables** on. Browser Sentry turns on only when
   `NEXT_PUBLIC_VERCEL_ENV` is `production` or `preview`, the offline page's
   revision uses `VERCEL_GIT_COMMIT_SHA`, and preview invite links use
   `VERCEL_BRANCH_URL`. A deployment outside Vercel must set
   `NEXT_PUBLIC_SENTRY_DSN` to report to Sentry at all.
3. Make the build install with the pnpm that `packageManager` pins
   (`pnpm@11.21.0`), not the pnpm 9 or 10 that Vercel picks from the
   lockfile otherwise: the `catalog:` version of postcss needs pnpm 9.5 or
   later. Vercel reads `packageManager` only through Corepack, so under
   **Settings → Environment Variables** add `ENABLE_EXPERIMENTAL_COREPACK`
   with the value `1` for this environment, unless it is already there. Leave
   the Install Command at its default. Keep the Build Command at the default
   `pnpm build`, whose `prebuild` step copies the PowerSync assets that the
   service worker precaches. After the deploy in step 5, open the deployment's
   build logs and check that the install step reports pnpm 11.21.0.

### 2. Database pre-checks

The schema migration of step 3 adds its constraints without `NOT VALID`, so
`db:push` fails on any row that breaks them. In the project's SQL editor, run:

```sql
SELECT
  (SELECT count(*) FROM sale_lines WHERE product_id IS NULL)
    AS sale_lines_without_product,
  (SELECT count(*) FROM products
    WHERE btrim(name) = '' OR btrim(category) = '')
    AS blank_products,
  (SELECT count(*) FROM products
    WHERE char_length(name) > 120 OR char_length(category) > 60)
    AS long_products,
  (SELECT count(*) FROM sale_lines
    WHERE btrim(product_name) = '' OR btrim(category) = ''
      OR line_discount_cents > unit_price_cents::bigint * quantity
      OR line_total_cents::bigint
        <> unit_price_cents::bigint * quantity - line_discount_cents)
    AS incoherent_sale_lines,
  (SELECT count(*) FROM inventory_movements
    WHERE NOT ((reason = 'initial' AND delta >= 0)
      OR (reason = 'restock' AND delta > 0)
      OR (reason IN ('loss', 'gift') AND delta < 0)
      OR (reason = 'adjustment' AND delta <> 0)))
    AS movements_breaking_sign_rules;
```

Every column must be `0`. For `long_products`, find the rows and shorten the
names or categories in the app first:

```sql
SELECT id, tenant_id, char_length(name) AS name_len,
  char_length(category) AS category_len
FROM products
WHERE char_length(name) > 120 OR char_length(category) > 60;
```

Any other non-zero count means bad data in a financial or stock record: stop
and investigate before pushing.

### 3. Migrations, then the category SQL

1. Link the project and run `pnpm db:push`. It applies:
   - `supabase/migrations/20260814135608_glorious_agent_zero.sql`: the
     `categories` table, one row per category of each puesto, with names of
     1 to 40 characters that are unique ignoring case.
   - `supabase/migrations/20260930035820_schema_integrity_and_product_field_times.sql`:
     `CHECK` constraints for blank names, sale line totals and the stock
     movement sign rules (an `initial` count may now be 0), product names up
     to 120 characters and categories up to 60, `NOT NULL` on
     `sale_lines.product_id`, index changes (3 dropped, 6 created) and
     `products.field_updated_at`, the per-column edit times that file 3 of
     step 6 keeps. Existing products start with none, and devices ignore the
     column, so it needs no PowerSync change. Index creation is not
     concurrent; that is fine at current table sizes.

   An environment that already runs a `develop` build with categories has
   the first one, and `db:push` applies only the second.

2. Right after, run these files in the project's SQL editor, in this order.
   They only touch the new table, which the old app never reads. Each one is
   idempotent, so an environment that already has them can run them again.
   1. [`supabase/manual/20260814235900_categories_rls.sql`](../supabase/manual/20260814235900_categories_rls.sql):
      RLS on `categories` by `tenant_users` membership. **Security-critical:**
      until it runs, anyone holding the publishable key can read and write
      every puesto's categories through PostgREST.
   2. [`supabase/manual/20260814235910_category_integrity_triggers.sql`](../supabase/manual/20260814235910_category_integrity_triggers.sql):
      renaming a category renames it on its products (sales keep the category
      they were sold under), and a category a product still uses cannot be
      deleted.
   3. [`supabase/manual/20260814235930_powersync_add_categories_to_publication.sql`](../supabase/manual/20260814235930_powersync_add_categories_to_publication.sql):
      adds `categories` to the `powersync` publication. Then check that
      `powersync_role` can read the new table (the query is under
      [PowerSync setup](../README.md#powersync-setup)); if it returns
      `false`, run `GRANT SELECT ON public.categories TO powersync_role;`.

### 4. PowerSync Sync Streams

Paste [`powersync/sync-rules.yaml`](../powersync/sync-rules.yaml) into the
environment's PowerSync Cloud **Sync Streams** editor, then **Validate** and
**Deploy**. The streams now sync `categories`, which is why they wait for
step 3, and every stream query also requires a `tenant_users` membership for
the signed-in user, not just the active tenant claim, so a removed member
stops syncing at once.

- Confirm that `tenant_users` is in the `powersync` publication (the query is
  under [PowerSync setup](../README.md#powersync-setup)). It already had to be.
- If **Validate** rejects the membership subquery (`AND … IN (SELECT …)`),
  the streams already deployed stay in place. Fix the file and validate again
  before going on to step 5. The syntax follows the PowerSync Sync Streams
  documentation but has not been through PowerSync Cloud's validator yet.

Deploy the streams before (or together with) the app in step 5. The old app
keeps working with them: it has no `categories` table, and ignores the rows.

### 5. The app, right away

Deploy this release's app build right after steps 3 and 4, never before.
Vercel deploys on push: every Preview deployment of this release's branch
already talks to staging, and a merge into the production branch deploys
production. So run steps 3 and 4 on staging before anyone opens such a
preview, and on production before merging.

The new app reads `categories` and `products.field_updated_at` when `/`
loads, so it fails on a database without them. It also writes an `initial`
stock movement of 0 when tracking is switched on with the count left blank,
and the old constraint rejects it (`23514`). A device that uploads one before
the migration shows a red sync pill, and every later upload from it (sales
included), its sign-out and tenant switching wait behind that one. Nothing is
lost: once the migration is applied, **Forzar sincronización** in Diagnostics
sends it.

The new server actions (checkout now sends a client-generated sale id, and
tenant-scoped actions take the tenant id the screen shows) do not match the
old app's calls either.

PowerSync applies the new client-side tables and indexes on each device when
the app starts; nothing else is needed for them.

### 6. The remaining hand-written SQL

First, once the app is deployed, ask vendors to close their installed app
completely (swipe it away in the app switcher) and reopen it with a working
connection, and to reload any browser tab they sell from. An app keeps
running the build it started with until then, and only the new build handles
the `NULL` results of file 1 below. On a device still running the old build,
a refund that loses to a void from another device fails its upload with a
generic error once file 1 is in place, leaves no failure to discard, and
every later upload from that device (sales included) stays pending behind it:
the sync pill shows pending operations, not a failure. Nothing is lost, and
reopening the app on the new build reverts the refund and sends the rest. So
get as many devices as you can onto the new build before file 1; you do not
have to wait for every one.

Then run these files in the project's SQL editor, in this order. Each one is
idempotent. To re-run one, run every later one after it as well: an older
file run on its own can put back what a newer one replaced.

1. [`supabase/manual/20260926120000_powersync_upload_convergence.sql`](../supabase/manual/20260926120000_powersync_upload_convergence.sql):
   rejects device timestamps more than 5 minutes ahead (retryable `55000`),
   makes cross-device void/refund conflicts converge (the losing call returns
   `NULL` and the new app reverts it on the device), checks whole-number
   payloads, and adds the refund trigger. It goes after the app deploy, since
   only the new app handles the `NULL` results.
2. [`supabase/manual/20260926130000_product_images_storage_rules.sql`](../supabase/manual/20260926130000_product_images_storage_rules.sql):
   the `product-images` bucket limits (JPEG and PNG, 5 MiB) and the upload and
   delete policies by tenant folder. Hosted buckets get their limits only from
   this file: do **not** use `supabase seed buckets --linked`, which would also
   upload the local seed images. Without PowerSync, the app now uploads photos
   with the user's session too, so it relies on an upload policy: this file's,
   or the one the migrations already created. Removing replaced photos uses
   `SUPABASE_SECRET_KEY` and is best effort.
3. [`supabase/manual/20260926130100_products_last_write_wins.sql`](../supabase/manual/20260926130100_products_last_write_wins.sql):
   product edits are last-write-wins by `updated_at`, column by column, so a
   late offline upload no longer overwrites a newer change to the same field
   and still applies its other changes, and a placeholder tone never replaces
   an uploaded image. It must run after file 1 and after the `db:push` of
   step 3, which adds the column it keeps. If this environment ever ran an
   earlier draft of this file (one that kept or dropped whole edits), run it
   again; its step 7 marker stays `false` until then.
4. [`supabase/manual/20260930120000_category_triggers_follow_latest_edit.sql`](../supabase/manual/20260930120000_category_triggers_follow_latest_edit.sql):
   replaces the category trigger functions of step 3. A rename now reaches a
   product last edited by a device whose clock ran a few minutes ahead (file 3
   kept such a product under the old name, a category that no longer exists),
   and a category can no longer move to another puesto. It must run after
   file 3 and after step 3's category files. Re-running step 3's
   `20260814235910` puts the old functions back; run this file after it
   again.

An environment that has not had every older `supabase/manual/` file must run
those first, in order (see
[Hand-written SQL](../README.md#hand-written-sql-supabasemanual)).

### 7. Check the database

In the SQL editor:

1. Run the verification queries under
   [Hand-written SQL](../README.md#hand-written-sql-supabasemanual): no public
   table without RLS, and every marker column `true`. A `false` marker names a
   file that has not been run, or that an older file run after it undid; run
   that file and every later one, in order.
2. Check the upload RPC grants. The first query must return `false`, the
   second `true`:

   ```sql
   SELECT has_function_privilege(
     'anon', 'public.powersync_create_sale(jsonb,jsonb)', 'EXECUTE');
   SELECT has_function_privilege(
     'authenticated', 'public.powersync_create_sale(jsonb,jsonb)', 'EXECUTE');
   ```

Then, in the dashboard's database settings, look at the connection pooler's
maximum client connections. Each server instance of the app now opens up to 7
connections to the transaction pooler instead of 5 (`lib/db/index.ts`), so
that maximum must stay well above 7 times the number of instances Vercel runs
at once. No change is expected at current traffic.

### 8. Supabase Auth

In the project's dashboard (all of these are per project; `config.toml` only
configures the local stack):

1. **Password settings:** minimum password length **8**, the same as the
   app's forms. Turn on leaked-password protection where the plan offers it
   (Pro, so production).
2. **Authentication → Email Templates**, after the app deploy (the templates
   link to `/auth/confirm` and `/auth/update-password`, which only the new app
   has). Emails already sent with the old template keep working through
   `/auth/callback`.
   - **Confirm signup:** subject `Confirmá tu correo | Billetera Ferial`,
     body [`supabase/templates/account-confirmation.html`](../supabase/templates/account-confirmation.html).
   - **Reset Password:** subject `Creá una contraseña nueva | Billetera Ferial`,
     body [`supabase/templates/password-recovery.html`](../supabase/templates/password-recovery.html).
3. **Authentication → URL Configuration:** **Site URL** must be the canonical
   app URL, because the email links now start with `{{ .SiteURL }}`. The
   **Redirect URLs** must already allow `<site>/auth/callback**` (the app still
   sends the callback URL as the redirect); no new entry is needed. Staging
   also needs the preview wildcard (see
   [Branch preview URLs](../README.md#branch-preview-urls-vercel)).

### 9. After the deploy

1. **Headers:** `curl -I https://<app-url>/` shows
   `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`,
   `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
   `Permissions-Policy` and `Accept-CH: Sec-CH-Prefers-Color-Scheme`.
2. **Sentry:** new events still arrive, tagged `production` or `preview`, and
   none carries query strings, `/join/<token>` paths or `DrizzleQueryError`
   parameters. Optionally add alerts for the new issue types: `client-failure`
   events (tagged by component, such as `powersync_init`) and the warning
   "PowerSync upload discarded on the device" (tag `sync_failure=discarded`),
   and the warning "PowerSync upload held by the device clock" (tag
   `sync_failure=held`, fingerprint `powersync-held-upload`), sent once for a
   transaction a device clock ahead has held back for 10 minutes. Browser
   events are now queued offline and sent on reconnect.
3. **Installed PWA:** it stays the same app (the manifest `id` is `/`, which
   Chrome derived before), and Android launchers show the new maskable icon.
4. **Product photos** still render. They are now requested with
   `crossOrigin="anonymous"` and rely on Supabase Storage sending
   `Access-Control-Allow-Origin: *`; a custom Storage domain or CDN without
   CORS would show placeholders instead. Existing photos keep their 1-hour
   `Cache-Control`; only new uploads get one year. No backfill is needed.
5. **Icons:** glance over the screens. lucide-react moved to 1.x, which may
   redraw some glyphs slightly.

### 10. Acceptance (staging), then production

On staging, run on installed iPhone Safari and Android Chrome PWAs:

- [`docs/sync-atomicity-acceptance.md`](sync-atomicity-acceptance.md):
  **Discarding a failed operation**, **Cross-device conflicts**, **Device
  clock ahead** (including the 12-hour case) and **Failure classification**.
- [`docs/stage-b-acceptance.md`](stage-b-acceptance.md): **Offline PWA
  Relaunch** (including more than 24 hours offline and the signed-out
  `/~offline` page), **Offline Relaunch Right After Signing In** (password
  sign-in, account switch and Google sign-in, each followed by an airplane
  mode relaunch with no online relaunch in between: Sell Mode must open) and
  **Offline Relaunch After An Update**. An installed app must be opened online
  once after the deploy before `/` is cached for offline starts.
- Categories, on two devices of one puesto: an existing puesto shows its
  products' categories under **Categorías**; a category created, renamed or
  deleted on one device shows on the other, online and after an offline
  spell; a rename moves the products on both; a category a product uses
  cannot be deleted; and Reports keep the category each sale was made under.

When they pass, repeat steps 1–9 on production, then run **Offline Relaunch
Right After Signing In** on installed production PWAs as well.

## What users may notice

- A tab left open across the deploy calls server actions that changed or no
  longer exist, and gets "Identificador de puesto inválido." or Next.js'
  "action not found" until it is reloaded.
- An installed PWA keeps running the old build until it is closed and
  reopened online. Until then, after step 6's file 1, a refund it made that
  loses to a void on another device keeps retrying its upload with a generic
  error, and every later upload from that device, sales included, stays
  pending on it behind that refund, with no failure to discard. Reopening the
  app on the new build reverts the refund and sends the rest. A void that
  loses to a refund is reverted at the next sync. Nothing is lost.
- Signing out now signs out only the current device.
- **Productos → Categorías → Gestionar** lists the puesto's categories:
  create, rename, and delete one that no product uses. The editor's category
  is a list of them, with **Crear categoría** at the end, and a product can
  no longer be saved without one. On its first load after the deploy, each
  puesto gets a category for every category its products already use (names
  over 40 characters excepted). Renaming a category renames it on its
  products; sales keep the category they were sold under.
- When two devices offline create the same category, rename one to a name
  the other has just created, rename one the other has just deleted, or one
  deletes a category the other has just filed a product under, the change
  that reaches the server second is dropped at the next sync instead of
  holding back that device's uploads. So is a later rename of a category
  whose create was dropped. A dropped rename still moves its products to the
  name.
- The app now addresses users as vos on every screen (before, only the
  sign-in screens and the More tab did), and Settings calls a tenant a
  "puesto", as the More tab already did. A tenant created on a first sign-in
  is named "Puesto de <name>"; existing tenants keep their "Cuenta de <name>"
  name. The auth emails already used vos, and their "cuenta" is the user's
  own account, so this wording change leaves them as they are: step 8's
  templates, pasted once, already carry it.
- Confirming an email address no longer signs in. The link opens the sign-in
  screen with "Tu correo está confirmado", and the user signs in with the
  password they chose.
- A device whose clock runs more than 5 minutes ahead no longer uploads
  future-dated sales. Its sync pill reads "Hora adelantada" and its uploads
  wait until real time reaches the time they were recorded with; correcting
  the clock only helps what is recorded afterwards.
- A product edited offline on two devices keeps, for each field, the change
  made last. Before, the upload that arrived last overwrote every field it
  carried.
- Turning stock tracking back on for a product asks for a count again. A
  count entered becomes the new starting point; left blank, the earlier count
  goes on, less everything sold since.

## Later

- Once every puesto has opened the app on this release, `/` no longer needs
  to look for product categories that have no category on each load
  (`ensureCategoriesForExistingProducts` in `lib/categories/repository.ts`).
- `categories_tenant_id_idx` duplicates the leading column of
  `categories_tenant_name_unique`; drop it in a later migration.

- **Before 2026-12-31:** check the Supabase API logs for calls to
  `powersync_void_sale` without `voided_at_value`. If there are none, drop the
  legacy two-argument overload in a new `supabase/manual/` file, and remove the
  legacy draft-cart shim (`readLegacyDraftCart`, `migrateLegacyDraftCartLocal`,
  `clearLegacyDraftCartStorage` and both localStorage keys in
  `lib/powersync/draft-cart.ts`).
- Anyone running `pnpm db:seed:qa` or `pnpm db:invite:tenant-user` against a
  hosted project passes all three target variables inline (or none, to use
  `.env.local`) and confirms with a typed `yes` or `--yes`.
