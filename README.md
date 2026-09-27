# Billetera Ferial

Offline-first point-of-sale PWA for Bolivian festival vendors.

This repository currently implements the Stage A product slice and the Stage B
offline/sync hardening code path from the PRD. Stage B is code-ready for
acceptance, but it is not considered accepted until the documented real-device
offline tests pass on iPhone Safari installed PWA and Android Chrome installed
PWA.

- Product catalog with categories, optional cost, archive/restore, and graceful image placeholders.
- Sell Mode as the default screen with tappable product grid, quantity badges, PowerSync-backed draft cart persistence, and a fixed Cobrar action.
- Cart review surface with quantity controls and clear-cart.
- Payment screen with sale-level discounts and cash/QR checkout.
- Immutable local sales with snapshotted price/cost data, recent sales, voids, refunds, and basic reports.
- PowerSync-backed local SQLite reads/writes for products, sales, sale lines, refunds, and local-only draft carts.
- Offline app shell through Serwist, with Supabase and PowerSync API responses kept network-only so synced data remains owned by PowerSync/local SQLite.
- Sync status visibility and a tester diagnostics surface for pending queue count, offline/reconnect state, errors, and last sync time.

## Run locally

For local Google sign-in, set
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in `.env.local` before starting the
local stack. The `pnpm db:*` scripts load that file before invoking the
Supabase CLI, so Auth reads the credentials at startup. In Google Auth
Platform, allow both local app origins (`http://localhost:3000` and
`http://127.0.0.1:3000`) and register
`http://127.0.0.1:54321/auth/v1/callback` as the authorized redirect URI.

```bash
corepack enable
pnpm install
pnpm db:start
pnpm db:reset
pnpm db:seed:buckets
pnpm dev
```

Then open `http://localhost:3000`.

`pnpm db:reset` applies the migrations, then every file in `supabase/manual/`
in order (see [Hand-written SQL](#hand-written-sql-supabasemanual)), then
`supabase/seed.sql`, which creates a reusable development account:

- Email: `demo@glitter-pos.local`
- Password: `glitter-demo`

The seeded account includes a demo tenant, active and archived products, a few
product images from `supabase/product-images/seed`, recent sales, a voided sale,
and a refunded sale for report/history testing.

### Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

CI (`.github/workflows/ci.yml`) runs the same checks on every pull request and
on pushes to `main`, `develop`, and `staging`.

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `INVITATION_SECRET_KEY` (any long random string locally, e.g.
  `openssl rand -base64 32`; keep it stable per environment, since changing it
  invalidates existing invitation links)
- `DATABASE_URL`

The server checks all five when it starts (`assertServerEnv` in `lib/env.ts`,
called from `instrumentation.ts`) and refuses to serve requests while any is
missing, so a misconfigured deploy fails at once, `/api/health` included.

**Local-only (no PowerSync):** leave `NEXT_PUBLIC_POWERSYNC_URL` empty. The app
loads products and sales from Supabase on the server and uses server actions for
writes. The sync pill is hidden and no local SQLite store is opened.

**Staging / production:** set `NEXT_PUBLIC_POWERSYNC_URL` to the PowerSync Cloud
instance URL for that environment (see [PowerSync setup](#powersync-setup) below).

`DATABASE_URL` should point at the Supabase Transaction Pooler (port `6543`). The runtime Drizzle client in `lib/db/index.ts` is configured with `prepare: false` to be compatible with it, and keeps a small pool (5 connections, closed after 20 s idle) per server instance.

## Cloud environments

Two Supabase cloud projects back this app:

- **`glitter-finance-staging`** — free plan. Used for branch testing, schema experiments, and QA validation. Safe to wipe.
- **`glitter-finance`** — Pro plan ($25/mo). Production. Migrations land here only after they pass on staging.

Only one project can be linked to the local checkout at a time. A developer relinks via the Supabase CLI when switching contexts:

```bash
# Working on a branch — point at staging:
supabase link --project-ref <staging-project-ref>
pnpm db:push       # applies pending migrations to glitter-finance-staging

# Ready to deploy — point at prod:
supabase link --project-ref <prod-project-ref>
pnpm db:push       # applies the same migrations to glitter-finance
```

`pnpm db:push` applies only `supabase/migrations/`. After it, run the
`supabase/manual/` files that project has not had yet, in order, in its SQL
editor (see [Hand-written SQL](#hand-written-sql-supabasemanual)). Deploy the
app only after both.

After relinking, update `.env.local` so `NEXT_PUBLIC_SUPABASE_URL`, the publishable and secret keys, and `DATABASE_URL` all match the now-linked project; otherwise the running app and the CLI will talk to different backends.

### Auth settings

`supabase/config.toml` configures only the local stack. Set these by hand in
each hosted project's Authentication settings:

- **Minimum password length: 8.** The app's forms enforce the same minimum
  (`MIN_PASSWORD_LENGTH` in `lib/auth/password.ts`). The Auth setting also
  covers sign-ups and password changes that call Supabase directly with the
  publishable key. Turn on leaked-password protection too if the plan offers
  it.

### Auth email templates

The version-controlled React Email sources for the Supabase auth emails live in
[`emails/`](emails): signup confirmation
([`account-confirmation.tsx`](emails/account-confirmation.tsx)) and password
recovery ([`password-recovery.tsx`](emails/password-recovery.tsx)). Preview
them locally, or export the email-safe HTML used by Supabase:

```bash
pnpm email:dev
pnpm email:export
```

The export writes one file per email to
[`supabase/templates/`](supabase/templates), with Supabase's `{{ .SiteURL }}`,
`{{ .TokenHash }}` and `{{ .RedirectTo }}` variables intact. Commit them: the
local stack loads them (`[auth.email.template.*]` in `supabase/config.toml`),
and `pnpm test` fails when they no longer match `emails/`. In each hosted
project, open **Authentication → Email Templates** and, for each template
below, set the subject and paste the HTML from `supabase/templates/`:

| Supabase template | Subject                                         | File                        |
| ----------------- | ----------------------------------------------- | --------------------------- |
| Confirm signup    | `Confirmá tu correo \| Billetera Ferial`        | `account-confirmation.html` |
| Reset Password    | `Creá una contraseña nueva \| Billetera Ferial` | `password-recovery.html`    |

Resend remains the configured SMTP provider; no Auth Hook is required.

The buttons link to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<email|recovery>&next={{ .RedirectTo }}`,
not to `{{ .ConfirmationURL }}`. `app/auth/confirm` verifies the token hash
with `verifyOtp`, which works in any browser. The default link goes through a
PKCE code exchange that needs a cookie only the browser that asked for the
email has, so it failed when the email was opened in the installed iOS app, an
email app's browser or another device. `next` carries the redirect URL the app
sent (`/auth/callback?next=…`), and the confirm route continues to that URL's
`next` path, such as an invitation link. A recovery link always continues to
`/auth/update-password`, where the user sets the new password. The app keeps
sending the callback URL as the redirect URL, so the redirect allow list needs
no new entry. `/auth/callback` still serves Google sign-in and emails that use
the default link.

### Testing auth emails locally

The local stack sends every auth email to Mailpit instead of a real inbox:
open <http://127.0.0.1:54324>. Links in the emails use the local `site_url`,
`http://127.0.0.1:3000`.

- **Password reset** works as it does in hosted projects: request a link from
  **¿Olvidaste tu contraseña?** and open it from Mailpit.
- **Signup confirmation** is off locally (`enable_confirmations = false` under
  `[auth.email]` in `supabase/config.toml`), so a new account signs in at once
  and the "Revisa tu correo" path never runs. To try it, set
  `enable_confirmations = true`, restart the stack (`pnpm db:stop`, then
  `pnpm db:start`) and sign up again. Set it back to `false` before
  committing.

The local stack reads `supabase/config.toml` only when it starts, so restart
it after changing an email template too.

### PowerSync setup

One-time bootstrap, run once per Supabase project that PowerSync Cloud will connect to (currently `glitter-finance-staging`, and `glitter-finance` once we deploy there). Not run via `db:push` because the role credential must be different per environment and should never live in git.

In the target project's Supabase dashboard, open the SQL editor and run:

```sql
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '<per-env-secret>';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
CREATE PUBLICATION powersync FOR TABLE products, sales, sale_lines, refunds, tenant_users, inventory_movements;
```

Notes:

- Generate a fresh `<per-env-secret>` for each environment (e.g. `openssl rand -base64 32`) and store it in a password manager. Do not reuse across staging and prod.
- The role has `REPLICATION BYPASSRLS` — it can read every row in every tenant, bypassing RLS. Treat the credential like a service-role key.
- The publication is targeted at exactly the six synced tables. When adding a new synced table later, run `ALTER PUBLICATION powersync ADD TABLE <name>` against each environment.
- **Existing environments (Stage D):** if `powersync` was created before `tenant_users` was added to the table list above, run [`supabase/manual/20260626010600_powersync_add_tenant_users_to_publication.sql`](supabase/manual/20260626010600_powersync_add_tenant_users_to_publication.sql) in the SQL editor after `pnpm db:push`. It is idempotent and skips quietly when the publication is missing (e.g. local `db:reset` before bootstrap).
- **Existing environments (inventory):** if `powersync` was created before `inventory_movements` was added, run [`supabase/manual/20260626170100_powersync_add_inventory_movements_to_publication.sql`](supabase/manual/20260626170100_powersync_add_inventory_movements_to_publication.sql) after `pnpm db:push`.
- Verify: `SELECT pubname FROM pg_publication;` should list `powersync`. Confirm `tenant_users` is published: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'tenant_users';`. Confirm `inventory_movements` is published: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'inventory_movements';`. Once PowerSync Cloud connects, a row appears in `SELECT * FROM pg_replication_slots;`.

#### Atomic financial uploads

Before deploying an app build containing the atomic PowerSync uploader, run
[`supabase/manual/20260808235900_powersync_atomic_financial_mutations.sql`](supabase/manual/20260808235900_powersync_atomic_financial_mutations.sql)
and then
[`supabase/manual/20260926120000_powersync_upload_convergence.sql`](supabase/manual/20260926120000_powersync_upload_convergence.sql)
in the target Supabase SQL editor. Apply them to staging first, run
[`docs/sync-atomicity-acceptance.md`](docs/sync-atomicity-acceptance.md), then
repeat against production before deploying the app there.

The SQL installs authenticated RPCs for sale + lines, void, and refund; revokes
direct authenticated writes to those financial tables; and adds triggers that
enforce the void window and "never both voided and refunded" in Postgres. It
also bounds device timestamps and makes cross-device void/refund conflicts
converge (see the PRD, §9 "Timestamps and conflicts"). Deploying the app first
is safe from data loss: a missing RPC is recorded as a sync failure and the
transaction stays queued, but checkout uploads remain blocked until the SQL is
installed.

`20260926120000_powersync_upload_convergence.sql` is best applied after the app
build that reverts local rows when a void or refund loses a conflict. An older
installed PWA whose refund loses to a void keeps retrying that upload until it
updates; nothing is lost.

Permanent upload errors remain in the PowerSync CRUD queue and are also stored
in the device-local `sync_failures` table. The sync pill turns red, tenant
switching/sign-out are blocked, and Diagnostics includes the complete operation
payload. After the underlying problem is fixed, **Forzar sincronización** retries
the same transaction; a successful atomic commit resolves the failure marker
automatically. Do not clear browser/PWA storage while a failure is unresolved.

Two rejections are retried without a failure marker, because they fix
themselves: a permission error while the device has no Supabase session (it
uploads again after sign-in), and a device timestamp more than 5 minutes ahead
of the server clock (Postgres code `55000`; it uploads once the server clock
catches up, so check the device clock if it persists).

Then configure the matching PowerSync Cloud instance. Each Supabase environment
must have its own PowerSync instance or a carefully separated configuration;
do not point staging app env vars at a prod PowerSync instance, or vice versa.

1. **Database connection.** In PowerSync Cloud, add/connect the target Supabase database using the `powersync_role` credentials above. The password must match the `CREATE ROLE ... PASSWORD` value exactly.
2. **Client Auth.** Enable **Use Supabase Auth**.
3. **JWKS URI.** Set the JWKS URI to the target Supabase project's JWKS endpoint:

   ```text
   https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
   ```

   This is required for Supabase projects using JWT signing keys such as ES256
   tokens with a `kid` header. Without it, clients fail with
   `PSYNC_S2101 Could not find an appropriate key in the keystore`.

4. **JWT Audience.** Add this accepted audience:

   ```text
   authenticated
   ```

   Supabase Auth access tokens use `aud: "authenticated"`. Without this,
   clients fail with `PSYNC_S2105 Unexpected "aud" claim value:
"authenticated"`.

5. **Sync Streams.** Paste [`powersync/sync-rules.yaml`](powersync/sync-rules.yaml)
   into the PowerSync Cloud **Sync Streams** editor, then **Validate** and
   **Deploy**. Without a deployed sync config, clients fail with
   `PSYNC_S2302 No sync config available`. Redeploy it in every environment
   whenever the file changes: the streams scope each device to its active
   tenant claim and to a `tenant_users` membership for the signed-in user.
6. **App environment.** Grab the instance URL from the PowerSync dashboard
   (typically `https://<id>.powersync.journeyapps.com`) and set it as
   `NEXT_PUBLIC_POWERSYNC_URL` in the matching app environment (`.env.local`
   locally, Vercel Production/Preview for deployed apps). Redeploy after
   changing any `NEXT_PUBLIC_*` variable because it is baked into the browser
   bundle.

PowerSync auth and app auth must point at the same Supabase project: the JWT's
`issuer` must match the Supabase project used for the JWKS URI, and its `kid`
must appear in that JWKS response. The connector (`lib/powersync/connector.ts`)
only hands PowerSync a token whose `app_metadata.tenant_id` is the tenant the
device's local data belongs to. Otherwise it refreshes the session once, and
if the claim still differs it logs a warning and PowerSync retries later;
Diagnostics then shows "La sesión todavía no corresponde al puesto de este
dispositivo", which a reload fixes.

**After `supabase db reset --linked`:** the reset drops everything in the `public` schema, which includes the `powersync` publication, the grants you gave `powersync_role`, and everything the `supabase/manual/` files installed there: the `inventory_movements` RLS, the financial RPCs and triggers, the product last-write-wins trigger and the Storage policy helper. The role itself survives (it's cluster-level, not database-level), and its password is unchanged. To restore the environment:

1. Re-run the grants + publication portion of the bootstrap (skip `CREATE ROLE`):

   ```sql
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
   CREATE PUBLICATION powersync FOR TABLE products, sales, sale_lines, refunds, tenant_users, inventory_movements;
   ```

2. Run every file in `supabase/manual/`, in order, in the SQL editor (see
   [Hand-written SQL](#hand-written-sql-supabasemanual)). The two publication
   scripts are no-ops once the publication above exists.
3. Run the verification queries from that section.

Also pass `--no-seed` when resetting any cloud project — the `supabase/seed.sql` script is local-only (creates a demo auth user with a known password, and assumes `pgcrypto` is enabled). It has no business running against staging or prod.

```bash
supabase db reset --linked --no-seed
```

### QA seed

`pnpm db:seed:qa` creates (or refreshes) a stable QA account on the Supabase project the env vars point at — typically `glitter-finance-staging`. It provisions a dummy catalog, completed sales, a voided sale, and a refunded sale, attached to a fixed tenant id so re-runs are idempotent. The auth user and tenant are always preserved; `--reset` only wipes the catalog and sales.

Pass the target credentials inline so the command always runs against the intended project:

```bash
QA_EMAIL=qa@glitterfinance.app QA_PASSWORD=... \
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
pnpm db:seed:qa             # append `-- --reset` to wipe catalog + sales and reseed
```

### Invite a tenant member (Stage D)

During closed testing, additional booth helpers are provisioned manually — not through in-app invite UI. `pnpm db:invite:tenant-user` creates (or refreshes) an auth user, inserts a `tenant_users` row on the target tenant, and sets `app_metadata.tenant_id` so PowerSync scopes replication correctly.

Before inviting:

1. Apply pending migrations (`pnpm db:push`) so `tenant_users.id` exists, then run [`supabase/manual/20260626010600_powersync_add_tenant_users_to_publication.sql`](supabase/manual/20260626010600_powersync_add_tenant_users_to_publication.sql) if the environment predates Stage D (see PowerSync setup notes).
2. Redeploy updated sync rules from `powersync/sync-rules.yaml` in PowerSync Cloud.

Then invite the helper:

```bash
TENANT_ID=7a000000-0000-4000-8000-000000000001 \
INVITE_EMAIL=helper@glitterfinance.app INVITE_PASSWORD=... \
INVITE_DISPLAY_NAME="Helper Booth" \
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
pnpm db:invite:tenant-user
```

After inviting, have the user sign in on their device. Settings → Equipo should list every member; reports should attribute sales by display name once both devices have synced.

### Stage B staging checklist

Before running Stage B acceptance on staging:

- Supabase migrations are applied to `glitter-finance-staging`.
- Every file in `supabase/manual/` has been run in order, and the verification
  queries under [Hand-written SQL](#hand-written-sql-supabasemanual) return the
  expected results.
- `powersync_role` exists with a per-environment password stored outside git.
- The `powersync` publication includes `products`, `sales`, `sale_lines`, `refunds`, `tenant_users`, and `inventory_movements`.
- PowerSync Client Auth uses the staging Supabase JWKS URI and accepts JWT audience `authenticated`.
- PowerSync sync rules from `powersync/sync-rules.yaml` are validated, deployed, and scoped by the authenticated tenant.
- `NEXT_PUBLIC_POWERSYNC_URL` points at the staging PowerSync instance.
- Supabase Auth **Redirect URLs** include the staging deployment URL(s) and
  `https://*-glitter-pos.vercel.app/**` if you test branch previews (see below).
- `NEXT_PUBLIC_APP_URL` is set only when staging uses a fixed custom domain;
  Vercel preview deployments resolve the URL from `VERCEL_BRANCH_URL` /
  `VERCEL_URL` automatically.
- The QA account is seeded with `pnpm db:seed:qa`.
- The installed PWA has been launched once online and the sync pill has reached the synced state before offline relaunch testing.

See [`docs/stage-d-acceptance.md`](docs/stage-d-acceptance.md) for multi-user /
`tenant_users` replication verification after Stage D deploys.

### Branch preview URLs (Vercel)

Invite links and sign-up email callbacks need a trusted public origin.
`lib/request-origin.ts` picks it automatically:

| Environment    | Source (in order)                                                      |
| -------------- | ---------------------------------------------------------------------- |
| Vercel preview | `VERCEL_BRANCH_URL` → `VERCEL_URL` → `NEXT_PUBLIC_APP_URL`             |
| Production     | `NEXT_PUBLIC_APP_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` |

**Vercel** — no extra env vars needed for branch previews. Ensure **Settings →
Environment Variables → “Automatically expose System Environment Variables”** is
enabled (default). Set `NEXT_PUBLIC_APP_URL` only for a fixed production custom
domain.

**Supabase** (`glitter-finance-staging` → Authentication → URL configuration):

1. **Site URL** — your main staging URL (fixed domain or primary
   `*-glitter-pos.vercel.app` deployment).
2. **Redirect URLs** — add each fixed URL plus a project-scoped wildcard for
   previews, e.g. `https://*-glitter-pos.vercel.app/**` and
   `https://your-staging-domain.com/**`.

Without the wildcard, sign-up email confirmation and OAuth callbacks fail on
branch deployments because Supabase rejects the dynamic preview origin.

**Deploy** — push and redeploy so `lib/request-origin.ts` and the login page
changes are live on staging.

### Production observability

Sentry captures browser, server, and permanent PowerSync upload errors with
privacy-safe defaults, from Vercel production and preview deployments only. Configure the runtime DSN, source-map token, email
alerts, and uptime monitor using
[`docs/production-observability.md`](docs/production-observability.md).

## Drizzle and Supabase: who owns what

Drizzle and Supabase both touch the database, but they sit at different points in the stack. Keeping that split clear avoids confusion when reading the codebase or running migration commands.

### Drizzle owns the schema and typed queries

- **Schema source of truth.** `lib/db/schema.ts` is hand-written in TypeScript. Every table, column, index, relation, and enum is defined there.
- **Typed query layer.** Server-side code reads and writes through `db` from `lib/db/index.ts`. The types flow directly from `schema.ts` with no codegen step.
- **Client-side reuse.** PowerSync uses the client schema in `lib/db/client-schema.ts` to type and materialize the per-device SQLite store. Server-only tables stay in `schema.ts`; local-only device state such as the draft cart lives only in the client schema.
- **Schema-to-SQL diffing.** `drizzle-kit generate` reads the schema, diffs it against the snapshots in `supabase/migrations/meta/`, and writes a new timestamp-prefixed SQL file into `supabase/migrations/`.

Drizzle does **not** apply migrations in this project, and does **not** own the journal that tracks which migrations have run. Those are Supabase CLI concerns.

### Supabase CLI owns migration application and the dev environment

- **Migration runner.** `supabase db push` applies the SQL files in `supabase/migrations/` against the linked cloud project, tracked in `supabase_migrations.schema_migrations`. `supabase db reset` rebuilds the local database from migrations, then the hand-written SQL and the seed (`[db.seed] sql_paths` in `supabase/config.toml`).
- **Local development stack.** `supabase start` boots Postgres, Auth, Storage, and the rest of the stack locally via Docker. The project is initialized via `supabase/config.toml`.
- **Things Drizzle cannot model.** RLS policies, `auth.users` foreign keys,
  storage policies, `ALTER PUBLICATION`, triggers, and grants are timestamped
  hand-written SQL under `supabase/manual/` and run in the SQL editor after
  `db:push` (see Hand-written SQL below). The hand-written files already in
  `supabase/migrations/` stay there as applied history, and `db:push` applies
  them: the custom Drizzle migrations from before this split
  (`20260607185713`, `20260607185822` and `20260610012303`, all in the Drizzle
  journal), and `20260628210000_tenant_invitations_rls.sql`, the one sanctioned
  exception. That file (`auth.users` FKs, `tenant_invitations` RLS and its
  revoke-only trigger) came after the split and sits outside the Drizzle
  journal. Moving it would break `db:push` on every environment that has
  applied it, so it stays; new hand-written SQL always goes in
  `supabase/manual/`.

### Daily commands

```bash
# Edit lib/db/schema.ts, then:
pnpm db:generate     # drizzle-kit generate — writes a new SQL file into supabase/migrations/

# Apply migrations:
pnpm db:push         # supabase db push — apply to the linked cloud project
pnpm db:reset        # supabase db reset — wipe and replay migrations, manual SQL and seed locally

# Local dev stack:
pnpm db:start        # supabase start
pnpm db:stop         # supabase stop
```

Do not run `drizzle-kit migrate`. The Drizzle `__drizzle_migrations` journal is not maintained; `supabase_migrations.schema_migrations` is the only journal that matters.

### Hand-written SQL (`supabase/manual/`)

For anything Drizzle's schema cannot express (RLS, `auth.users` FKs, storage
policies, triggers, functions, grants, `ALTER PUBLICATION`), add a new file
under `supabase/manual/` named `YYYYMMDDHHMMSS_description.sql`, with a
timestamp after every existing file. Write it so it can be re-run
(`CREATE OR REPLACE`, `DROP ... IF EXISTS`, guarded `DO` blocks), and never
edit a file that has shipped to an environment: fix forward with a new file.

`pnpm db:push` does not apply these files, and nothing records which ones an
environment has had. Run them in the target project's SQL editor, in the order
below:

- **Fresh environment** (a new project, or after `supabase db reset --linked`):
  after `pnpm db:push`, run every file in order.
- **Existing environment:** after `pnpm db:push`, run every file newer than the
  last one it has had. Re-running an older file is harmless.
- **Local stack:** `pnpm db:reset` runs all of them after the migrations and
  before `seed.sql`.

1. [`20260610012304_product_image_upload_policy_membership.sql`](supabase/manual/20260610012304_product_image_upload_policy_membership.sql):
   Storage upload policy checked by `tenant_users` membership instead of the
   JWT claim. Every environment; file 7 replaces the policy.
2. [`20260626010600_powersync_add_tenant_users_to_publication.sql`](supabase/manual/20260626010600_powersync_add_tenant_users_to_publication.sql):
   adds `tenant_users` to the `powersync` publication. Needed where the
   publication predates Stage D; skips when it is already there or there is
   no publication.
3. [`20260626170000_inventory_movements_rls.sql`](supabase/manual/20260626170000_inventory_movements_rls.sql):
   `auth.users` FK and append-only RLS on `inventory_movements`. **Every
   environment, security-critical:** until it runs, the table has RLS disabled
   and anyone holding the publishable key can read and write every tenant's
   movements through PostgREST.
4. [`20260626170100_powersync_add_inventory_movements_to_publication.sql`](supabase/manual/20260626170100_powersync_add_inventory_movements_to_publication.sql):
   adds `inventory_movements` to the publication. Needed where the publication
   predates inventory tracking; skips otherwise.
5. [`20260808235900_powersync_atomic_financial_mutations.sql`](supabase/manual/20260808235900_powersync_atomic_financial_mutations.sql):
   atomic RPCs for sale, void and refund uploads, revokes direct financial
   writes, and the void trigger. Every environment, before deploying the
   atomic uploader (see [Atomic financial uploads](#atomic-financial-uploads)).
6. [`20260926120000_powersync_upload_convergence.sql`](supabase/manual/20260926120000_powersync_upload_convergence.sql):
   replaces the functions from file 5 with device-timestamp bounds, void/refund
   conflict convergence and whole-number payload checks, and adds the refund
   trigger. Every environment, after file 5.
7. [`20260926130000_product_images_storage_rules.sql`](supabase/manual/20260926130000_product_images_storage_rules.sql):
   `product-images` bucket limits (JPEG and PNG, 5 MiB) and the Storage upload
   and delete policies by tenant folder. Every environment. Hosted buckets get
   their limits only from this file; do not use `supabase seed buckets --linked`,
   which would also upload the local seed images.
8. [`20260926130100_products_last_write_wins.sql`](supabase/manual/20260926130100_products_last_write_wins.sql):
   product edits keep the newer `updated_at`, so a late offline upload no longer
   overwrites a newer edit. Every environment, after file 6.

To check an environment, run in its SQL editor:

```sql
-- Public tables without RLS (expect no rows):
SELECT c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

-- A marker for each file that installs RLS, functions or triggers in public
-- (expect every column true):
SELECT
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.inventory_movements'::regclass) AS "20260626170000",
  to_regprocedure('public.powersync_create_sale(jsonb,jsonb)') IS NOT NULL
    AS "20260808235900",
  to_regprocedure('public.check_upload_timestamp(timestamptz,text)') IS NOT NULL
    AS "20260926120000",
  to_regprocedure('public.product_image_tenant_id(text)') IS NOT NULL
    AS "20260926130000",
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'products_keep_latest_edit')
    AS "20260926130100";
```

Confirm the publication with the queries under [PowerSync setup](#powersync-setup).

### Runtime data access

Server-only code imports `db` from `lib/db/index.ts` for typed reads and writes through Drizzle. `db` connects directly to Postgres, so it bypasses RLS — treat it as a trusted server context and gate access at the application layer (see `lib/auth/user-context.ts` for the tenant scoping pattern). The `@supabase/ssr` clients in `lib/supabase/` are used for auth and session cookies, not for product/sales data.

## Product docs

The PRD lives in [`docs/glitter-finance-prd.md`](docs/glitter-finance-prd.md).
