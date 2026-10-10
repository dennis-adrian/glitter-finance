# Upgrading to the next release

What an environment running the previous release, **v0.8.0**, needs, in
order, when this release is deployed. Do everything on **staging**
(`glitter-finance-staging`, its PowerSync instance and the Vercel environment
that serves it) first, run the acceptance checks at the end, and only then
repeat the same steps on **production** (`glitter-finance`).

Once every environment has had these steps, keep what still applies in the
README and empty this file for the release after.

## What changes for operators

| Area                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App environment       | The server now checks at startup that the required variables, `INVITATION_SECRET_KEY` included, are set. Browser Sentry reports only from Vercel production and preview deployments.                                                                                                                                                                                                                                                                                                 |
| Product categories    | Products now point to their category by id (`products.category_id`, a foreign key to the puesto's `categories` row) instead of by name. `products.category` stays, derived from the id, for v0.7.0 and v0.8.0 devices and for sale lines. Existing products are linked by the category SQL file, run in step 3 right after `db:push` and again at the end of step 6, no longer on the first load of `/`.                                                                             |
| Database schema       | Four Drizzle migrations: stricter `CHECK` constraints (they fail on rows that break them), a zero `initial` stock count allowed, index changes, text length caps and per-field edit times; then the nullable `products.category_id` with its index; then its foreign key; then the product name cap raised from 120 to 240 characters.                                                                                                                                               |
| Hand-written SQL      | Six new `supabase/manual/` files: upload timestamp bounds and void/refund convergence, Storage limits and policies for product images, per-field last-write-wins product edits, category renames that win over those edit times, products stored with their category's spelling, and products linked to their category by id. The last one replaces the name-based category triggers (v0.8.0's and the two before it); it runs before the app deploy and again at the end of step 6. |
| PowerSync             | Every sync stream now also requires a `tenant_users` membership, so the streams must be redeployed.                                                                                                                                                                                                                                                                                                                                                                                  |
| Supabase Auth         | Minimum password length 8, and new confirmation and password recovery email templates that link to `/auth/confirm`.                                                                                                                                                                                                                                                                                                                                                                  |
| Response headers, PWA | App-wide security headers, a manifest with a stable `id` and maskable icons, product photos cached offline, and an offline page.                                                                                                                                                                                                                                                                                                                                                     |
| App screens           | A responsive layout for phones, tablets and desktops, a new order and checkout flow, and Reportes in the main navigation (see [What users may notice](#what-users-may-notice)). Nothing to configure.                                                                                                                                                                                                                                                                                |
| Tooling (developers)  | A pnpm catalog, TypeScript 6.0 (the newest typescript-eslint supports), Supabase CLI 2.115.0 or later, and CI checks on every pull request.                                                                                                                                                                                                                                                                                                                                          |

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

First, with the project linked, run `supabase migration list --linked`. The
remote column must not list `20260929030615` or `20260929030640`: those are
earlier drafts of this release's category-id migrations, which a preview of
the branch may have pushed to staging (with the draft's
`20260929030700_product_category_ids.sql`). If either is there, stop:
`db:push` would fail adding `products.category_id` again, so that environment
needs a `supabase migration repair` and a cleanup of the draft's objects
first. The
list also shows which of step 3's migrations the environment already has.

The schema migration of step 3 adds its constraints without `NOT VALID`, so
`db:push` fails on any row that breaks them. In the project's SQL editor, as
its default `postgres` role (as `authenticated` or `anon`, RLS hides the rows
and every count reads `0`), run:

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

Every column must be `0`. `long_products` checks names against 120
characters, not 240: the first migration of step 3 adds the 120 cap, and
only the fourth raises it. For `long_products`, find the rows and shorten the
names or categories in the app first:

```sql
SELECT id, tenant_id, char_length(name) AS name_len,
  char_length(category) AS category_len
FROM products
WHERE char_length(name) > 120 OR char_length(category) > 60;
```

Any other non-zero count means bad data in a financial or stock record: stop
and investigate before pushing.

Then check that the schema is the one the migrations expect. The counts above
look only at rows, so they miss a change made in the dashboard, such as an
index added or dropped on a Supabase advisor's suggestion, that makes
`db:push` fail on an index, constraint or column name. This must return no
rows:

```sql
SELECT 'missing (migration drops it): ' || n AS problem
FROM unnest(ARRAY['products_tenant_id_idx','tenant_users_tenant_id_idx','inventory_movements_one_initial_per_product_idx']) AS n
WHERE to_regclass('public.' || quote_ident(n)) IS NULL
UNION ALL
SELECT 'name already used (migration creates it): ' || n
FROM unnest(ARRAY['inventory_movements_user_id_idx','refunds_user_id_idx','sale_lines_product_id_tenant_id_idx','sales_voided_by_user_id_idx','tenant_invitations_created_by_user_id_idx','tenants_created_by_user_id_idx','products_category_id_tenant_id_idx','categories_id_tenant_id_unique']) AS n
WHERE to_regclass('public.' || quote_ident(n)) IS NOT NULL
UNION ALL
SELECT 'missing constraint (migration drops it): inventory_movements.' || n
FROM unnest(ARRAY['inventory_movements_delta_nonzero_check','inventory_movements_sign_discipline_check']) AS n
WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory_movements'::regclass AND conname = n)
UNION ALL
SELECT 'constraint name already used: ' || c.conrelid::regclass || '.' || c.conname
FROM pg_constraint c JOIN (VALUES
  ('products','products_name_not_blank_check'),('products','products_category_not_blank_check'),
  ('products','products_name_length_check'),('products','products_category_length_check'),
  ('products','products_category_id_tenant_id_categories_id_tenant_id_fk'),
  ('sale_lines','sale_lines_product_name_not_blank_check'),('sale_lines','sale_lines_category_not_blank_check'),
  ('sale_lines','sale_lines_discount_within_gross_check'),('sale_lines','sale_lines_total_coherence_check'),
  ('categories','categories_id_tenant_id_unique')
) AS v(tbl, n) ON c.conrelid = ('public.' || v.tbl)::regclass AND c.conname = v.n
UNION ALL
SELECT 'column already exists: products.' || attname FROM pg_attribute
WHERE attrelid = 'public.products'::regclass AND attname IN ('field_updated_at','category_id') AND NOT attisdropped;
```

It is written for an environment on v0.8.0, whose migration list does not
show `20260930035820`. On one that already has that migration, it lists that
migration's own objects, which is expected. If it reports a name taken by an
index with the same definition, drop that index before `db:push`: the
migration creates it again. For any other row, stop and compare with the
migration before pushing.

Then see what the category SQL of step 3 will do to the categories. It links
every product to the category of its name and creates the ones that are
missing:

```sql
WITH p AS (
  SELECT tenant_id, btrim(regexp_replace(category, '\s+', ' ', 'g')) AS name
  FROM products
)
SELECT
  (SELECT count(*) FROM p WHERE NOT EXISTS (
      SELECT 1 FROM categories c
      WHERE c.tenant_id = p.tenant_id AND lower(c.name) = lower(p.name)))
    AS products_without_category,
  (SELECT count(*) FROM p
    WHERE char_length(p.name) > 40 AND NOT EXISTS (
      SELECT 1 FROM categories c
      WHERE c.tenant_id = p.tenant_id AND lower(c.name) = lower(p.name)))
    AS names_cut_to_40,
  (SELECT count(*) FROM p WHERE lower(p.name) = 'todos')
    AS go_to_sin_categoria;
```

None of these blocks the release:

- `products_without_category`: products whose name has no category yet. The
  file gives them one. v0.7.0's old names Pegatina(s), Lámina(s) and Pins go
  to Stickers, Prints and Pines, which the file creates if the puesto lacks
  them, unless the puesto already has a category with the old name (in any case).
- `names_cut_to_40`: their new category gets the first 40 characters of the
  name. To avoid that, move those products to another category in the app
  first.
- `go_to_sin_categoria`: products filed under "Todos" (the filters'
  show-everything option) go to "Sin categoría".

### 3. Migrations, then the category SQL

1. Link the project and run `pnpm db:push`. It applies:
   - `supabase/migrations/20260930035820_schema_integrity_and_product_field_times.sql`:
     `CHECK` constraints for blank names, sale line totals and the stock
     movement sign rules (an `initial` count may now be 0), product names up
     to 120 characters (the fourth migration raises it to 240) and
     categories up to 60, `NOT NULL` on
     `sale_lines.product_id`, index changes (3 dropped, 6 created) and
     `products.field_updated_at`, the per-column edit times that file 3 of
     step 6 keeps. Existing products start with none, and devices ignore the
     column, so it needs no PowerSync change. Index creation is not
     concurrent; that is fine at current table sizes.
   - `supabase/migrations/20261010021758_product_category_id.sql`: the
     nullable `products.category_id`, its index, and the unique
     `(id, tenant_id)` on `categories` that the foreign key needs. The old
     app ignores the column; every product keeps `NULL` there until item 3
     links it.
   - `supabase/migrations/20261010022414_product_category_fk.sql`: the
     foreign key from `(category_id, tenant_id)` to the category's
     `(id, tenant_id)`, which refuses to delete a category a product uses.
     `NULL` ids are not checked, so it adds without touching existing rows.
   - `supabase/migrations/20261010121713_product_name_240_chars.sql`: raises
     the product name cap from 120 to 240 characters. It drops and re-adds
     `products_name_length_check`, which briefly locks `products` like the
     first migration.

   An environment that already runs a `develop` build has the first one, and
   `db:push` applies only the others. An environment still on v0.7.0 also
   gets `20260814135608_glorious_agent_zero.sql`, the `categories` table.

   From this push on, a device still on v0.8.0 cannot save a product name
   longer than 240 characters (see
   [What users may notice](#what-users-may-notice)).

   The first migration holds an exclusive lock on `products`, `sale_lines`,
   `inventory_movements` and `tenant_users` until it commits. Every RLS
   policy reads `tenant_users`, so the whole app waits while it runs (0.4 s
   on a rehearsal copy). The Supabase CLI does not seem to set a
   `lock_timeout` for migration files, so if a long transaction holds one of
   those tables, the push waits for it and every query queues behind the
   push. So push at a quiet hour, and first check that this returns no rows:

   ```sql
   SELECT pid, state, now() - xact_start AS open_for, left(query, 80)
   FROM pg_stat_activity
   WHERE backend_type = 'client backend'
     AND xact_start < now() - interval '5 seconds'
     AND pid <> pg_backend_pid();
   ```

   If the push hangs, find its backend in `pg_stat_activity`
   (`wait_event_type = 'Lock'`) and cancel it from the SQL editor with
   `SELECT pg_cancel_backend(<pid>);`. Stopping the CLI alone may leave the
   wait in place on the server. The migration rolls back; run `pnpm db:push`
   again.

2. v0.8.0 shipped these three files, so an environment on v0.8.0 already
   has them and skips this item. An environment still on v0.7.0 runs them
   right after `db:push`, in this order. They only touch the `categories`
   table, which the v0.7.0 app never reads. Each one is idempotent, so an
   environment that already has them can run them again, as long as step 6
   then runs in full.
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

3. Right after that, before the app deploy of step 5, run
   [`supabase/manual/20261009120000_product_category_ids.sql`](../supabase/manual/20261009120000_product_category_ids.sql),
   the file that links products to their category by id. It runs again as
   the last file of step 6, but does not need that step's files 1 to 5.
   - It installs the id triggers: they resolve the category name that
     v0.7.0 and v0.8.0 devices send, creating a category that is missing;
     derive `products.category` from the id; rename a category's products
     by id without touching `updated_at`; and refuse to move a category to
     another puesto (`23514`). It grants `authenticated` what the uploads
     need. It retires the name-based triggers of item 2's `20260814235910`:
     the foreign key now refuses to delete a category in use, with `23503`,
     as that trigger did. Then it links every existing product to its
     category (see step 2's last query).
   - It must run before the new app is deployed. That app writes
     `category_id`, and an id the server does not have (a category whose
     create lost to another device's same name, or one deleted on another
     device) fails the foreign key with `23503` without these triggers,
     which holds every later upload from that device. With them, such an id
     resolves by the category's name.
   - The old app keeps working with it: v0.8.0 sends and reads only the
     name, and the triggers keep the name in step with the id.
   - It runs in one transaction with a 5 s `lock_timeout`, and rolls back if
     another session holds `products` or `categories` or if any of its
     checks fails; just run it again. While it runs, writes to both tables
     wait, and so do reads, until it commits (well under a second at current
     sizes).
   - It rewrites every product row once, so every device, old build
     included, downloads all the products again at its next sync. No stream
     change is needed.

### 4. PowerSync Sync Streams

Paste [`powersync/sync-rules.yaml`](../powersync/sync-rules.yaml) into the
environment's PowerSync Cloud **Sync Streams** editor, then **Validate** and
**Deploy**. Every stream query now also requires a `tenant_users` membership
for the signed-in user, not just the active tenant claim, so a removed member
stops syncing at once. The streams select whole rows, so
`products.category_id` reaches devices with no stream change.

- Confirm that `tenant_users` is in the `powersync` publication (the query is
  under [PowerSync setup](../README.md#powersync-setup)). It already had to be.
- Every stream query changes, so PowerSync most likely rebuilds every stream,
  and each device then downloads everything it syncs again: sales, refunds
  and stock history included, not just the products of step 3. Deploy at a
  quiet hour, and on staging note how long a device with a long sales
  history takes.
- If **Validate** rejects the membership subquery (`AND … IN (SELECT …)`),
  the streams already deployed stay in place. Fix the file and validate again
  before going on to step 5. The syntax follows the PowerSync Sync Streams
  documentation but has not been through PowerSync Cloud's validator yet.

Deploy the streams before (or together with) the app in step 5. The old app
keeps working with them and ignores the new column. On an environment still
on v0.7.0, they also start syncing `categories`, so they wait for step 3.

### 5. The app, right away

Deploy this release's app build right after steps 3 and 4, never before.
Vercel deploys on push: every Preview deployment of this release's branch
already talks to staging, and a merge into the production branch deploys
production. So run steps 3 and 4 on staging before anyone opens such a
preview, and on production before merging.

The new app reads `products.field_updated_at` and `products.category_id` when
`/` loads, so it fails on a database without them. It also writes
`category_id` whenever it files a product under a category, which is why
step 3's category SQL comes first: an id the server lacks then resolves by
name instead of holding the device's uploads. It also writes an `initial`
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
the sync pill shows pending operations, not a failure. Reopening the app on
the new build reverts the refund and sends the rest.

The same goes for a device whose clock runs more than 5 minutes ahead. After
file 1 (and file 3, for product edits), the old build's uploads from it fail
with a retryable error and no failure, until real time reaches the time they
were recorded with. That build's sync pill never shows "Hora adelantada",
only pending operations.

While an old build's uploads wait this way, with no failure, its **Ajustes →
Cerrar sesión** does not stop the user: it signs out and deletes the waiting
uploads, sales included. (**Más → Cerrar sesión** waits for them.) So get as
many devices as you can onto the new build before file 1; you do not have to
wait for every one. Tell vendors that if the app still shows pending
operations, they should reopen it online to update it, never sign out from
Ajustes, and correct the device's clock if it is wrong.

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
5. [`supabase/manual/20260930130000_products_use_category_spelling.sql`](../supabase/manual/20260930130000_products_use_category_spelling.sql):
   a product whose category matches one of its puesto's categories ignoring
   case is stored with that category's spelling, and the products already
   stored otherwise are respelled. The rename and delete triggers match the
   exact spelling, so without it a product uploaded after the uploader
   dropped its category's create or rename (another device had taken the
   name in another case) counted for no category: that category could be
   renamed or deleted without it. It must run after files 3 and 4.
6. [`supabase/manual/20261009120000_product_category_ids.sql`](../supabase/manual/20261009120000_product_category_ids.sql),
   again, right after file 5: step 3 ran it already, and files 4 and 5 put
   name-based triggers back next to its id triggers (until this run, a
   category rename also stamps its products' `updated_at`). This run
   retires them again, links any product still without an id and checks the
   result. Products are already linked, so it rewrites none.
   - If it is skipped, step 7's `"20261009120000"` and `"20260814235910"`
     markers read `false` (file 4 replaces the functions of
     `20260814235910` but not the delete trigger step 3's run dropped). Run
     this file again; no older file needs to run first.
   - Re-running `20260814235910` or files 4 or 5 later puts the name
     triggers back too: run this file after them again.
   - It drops those triggers, so reads of `products` and `categories` wait
     until it commits, as in step 3 (well under a second). If it rolls back
     on its 5 s `lock_timeout`, run it again.

An environment that has not had every older `supabase/manual/` file must run
those first, in order (see
[Hand-written SQL](../README.md#hand-written-sql-supabasemanual)).

### 7. Check the database

In the SQL editor:

1. Run the verification queries under
   [Hand-written SQL](../README.md#hand-written-sql-supabasemanual): no public
   table without RLS, and every marker column `true`. A `false` marker names a
   file that has not been run, or that an older file run after it undid; run
   that file and every later one, in order. The `"20261009120000"` column is
   new: it checks the category SQL of steps 3 and 6, and reads `false` while
   any product has no `category_id` or while a name-based category trigger is
   back (step 6's run of it was skipped, or an older file ran after it;
   `"20260814235910"` then usually reads `false` too). Run that file again.
   The `"20260814235910"`, `"20260930120000"` and `"20260930130000"` columns
   also read `true` once that file has replaced their triggers.
2. Check the category grants and links. The first query must return `0`, the
   second `true`:

   ```sql
   SELECT count(*) FROM products WHERE category_id IS NULL;
   SELECT has_table_privilege('authenticated', 'public.categories', 'INSERT');
   ```

3. Check the upload RPC grants. The first query must return `false`, the
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
  mode relaunch with no online relaunch in between: Vender must open) and
  **Offline Relaunch After An Update**. An installed app must be opened online
  once after the deploy before `/` is cached for offline starts.
- Categories, on two devices of one puesto running this release: existing
  products show under their categories in **Catálogo › Categorías** and in
  the filters; a category created, renamed or deleted on one device shows on
  the other, online and after an offline spell; a rename keeps the products
  in the category on both; the same name created offline on both, in
  different case, ends as one category with the products of both under it; a
  category a product uses cannot be deleted; and Reports keep the category
  each sale was made under.
- Categories with older builds: with one device on v0.7.0 and one on v0.8.0
  (an installed PWA not reopened since the deploy, or an older Vercel
  deployment of that build), each creates a product and moves one to another
  category, and a category is renamed on this release. Both older devices
  show the new name, and every product keeps its category. A v0.8.0 delete
  of a category in use is refused with `23503` and holds that device's
  uploads, as it does on v0.8.0 today; updating the device clears it.
- Selling, on a phone, a tablet and a desktop: add products, open the order
  (sheet or side panel), apply a line discount and a sale discount, choose
  **Efectivo** with a received amount, and check that nothing is recorded
  until **Registrar venta**; the confirmation shows the change, and the sale
  appears in **Ventas** and **Reportes**. Reload on each screen and use the
  back button: both stay in the app.

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
  loses to a refund is reverted at the next sync. Nothing is lost unless the
  user signs out from **Ajustes** on the old build while uploads wait, which
  deletes them (see step 6).
- A device still on v0.8.0 that saves a product name longer than 240
  characters (v0.8.0 sets no limit; this release's editor stops at 240)
  fails that upload with `23514` once step 3's migrations are in. Its sync
  pill shows an error, and every later upload from it, sales included, waits
  behind that one. v0.8.0 cannot discard it: update the app, then use
  **Descartar operación** in Diagnostics and enter the product again with a
  shorter name.
- Signing out now signs out only the current device.
- The screens are reorganized, and work on tablets and desktops instead of
  showing a framed phone:
  - The navigation has five destinations, **Vender**, **Ventas**,
    **Catálogo**, **Reportes** and **Más**: Reportes moved out of Más. Phones
    keep it at the bottom; tablets and desktops get a side rail, labeled on
    wide screens.
  - The cart is now the **pedido**: a sheet opened from the bar at the bottom
    of Vender on phones and tablets, and a panel beside the products on
    desktops. A tile's `−` button takes one off; a long press still works.
  - **Cobrar** opens a checkout screen with the sale discount, **Efectivo**
    (selected by default, with the amount received and the change) or
    **QR**. Choosing a method no longer records the sale: it is recorded only
    on **Registrar venta**, and a confirmation screen follows, with **Nueva
    venta** and **Compartir recibo**.
  - Each screen has its own address after `#` (for example `/#/ventas`), so
    the browser's back button and a reload stay on it. Links to `/` still
    open Vender.
  - Buttons and titles are in sentence case (“Cobrar”, “Iniciar sesión”),
    no longer all caps.
  - Categories are managed in **Catálogo › Categorías**. The editor shows
    them as chips, with **Nueva categoría** at the end.
- Products now belong to their category by id. A rename keeps every product
  in the category, on every device, offline ones included; sales keep the
  category they were sold under.
- When step 3's category SQL runs, every device downloads all its products
  again at its next sync, which may take a moment on a slow connection. The
  streams of step 4 most likely make it download everything it syncs once
  more, sales history included.
  Products filed under "Todos" move to "Sin categoría", and products whose
  category name is over 40 characters (v0.8.0 created no category for them)
  get one named with its first 40. Products filed under v0.7.0's old names
  Pegatina(s), Lámina(s) or Pins go to Stickers, Prints or Pines, created if
  the puesto has none, unless the puesto has a category with the old name.
- When two devices offline create the same category, rename one to a name
  the other has just created, rename one the other has just deleted, or one
  deletes a category the other has just filed a product under, the change
  that reaches the server second is dropped at the next sync instead of
  holding back that device's uploads. So is a later rename of a category
  whose create was dropped. A product filed under a category whose create
  was dropped joins the puesto's category of the same name; a dropped rename
  leaves its products in the category, under its name on the server.
- A device still on v0.7.0 or v0.8.0 that files a new product under a
  category deleted on another device brings that category back. Moving an
  existing product there is ignored, and the product stays in its category,
  unless it is one of v0.7.0's four fixed categories (Stickers, Prints,
  Pines, Accesorios), which come back. A v0.8.0 device that
  deletes a category in use, or creates or renames one to a name the puesto
  already has, holds its uploads until it is updated, as on v0.8.0 today.
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
  the clock only helps what is recorded afterwards. On a device still on
  v0.8.0 the pill shows no error, only pending operations, and a sign-out
  from **Ajustes** deletes them (see step 6).
- A product edited offline on two devices keeps, for each field, the change
  made last. Before, the upload that arrived last overwrote every field it
  carried.
- Turning stock tracking back on for a product asks for a count again. A
  count entered becomes the new starting point; left blank, the earlier count
  goes on, less everything sold since.

## Later

- Once no device runs v0.7.0 or v0.8.0 and their upload queues have drained,
  and `SELECT count(*) FROM products WHERE category_id IS NULL` returns `0`
  on every environment, a migration can make `products.category_id`
  `NOT NULL`. Dropping `products.category`, and the name resolution in
  `products_category_resolve_id`, is optional after that; until then, both
  stay, since older devices only send and read the name.
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
