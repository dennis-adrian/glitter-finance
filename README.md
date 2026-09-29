# Billetera Ferial

Offline-first point-of-sale PWA for Bolivian festival vendors.

This repository implements the code for the PRD's build stages A to D (the
core POS loop, offline and sync hardening, date-range reports, and several
users per account) plus optional per-product inventory tracking
([`docs/glitter-inventory-prd.md`](docs/glitter-inventory-prd.md)). A stage is
not considered accepted until its documented real-device tests pass: see
[`docs/stage-b-acceptance.md`](docs/stage-b-acceptance.md) (installed PWAs on
iPhone Safari and Android Chrome) and
[`docs/stage-d-acceptance.md`](docs/stage-d-acceptance.md).

- Product catalog with categories, optional cost, archive/restore, and graceful image placeholders.
- Sell Mode as the default screen with tappable product grid, quantity badges, PowerSync-backed draft cart persistence, and a fixed Cobrar action.
- Cart review surface with quantity controls, per-line discounts, and clear-cart (with undo).
- Payment screen with sale-level discounts and cash/QR checkout.
- Immutable local sales with snapshotted price/cost data, a sales list, voids, refunds, and date-range reports.
- Email and password or Google sign-in, with email confirmation and password reset.
- Several tenants per user, with a tenant switcher and invitation links for adding team members (Settings → Equipo).
- Optional stock tracking per product: initial count, restocks, adjustments, losses and gifts, with low-stock and oversold states.
- PowerSync-backed local SQLite reads/writes for products, sales, sale lines, refunds, inventory movements, and local-only draft carts, plus the synced team list.
- Offline app shell through Serwist, with Supabase and PowerSync API responses kept network-only so synced data remains owned by PowerSync/local SQLite. Product photos from Supabase Storage are the one exception: the service worker caches them so Sell tiles keep their images offline.
- Sync status visibility and a tester diagnostics surface for pending queue count, offline/reconnect state, errors, and last sync time.

## Run locally

You need Node 24 (see `.nvmrc`), Docker for the local Supabase stack, and the
[Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)
**2.115.0 or later** on your `PATH` (for example
`brew install supabase/tap/supabase`, and `brew upgrade supabase` later). The
CLI is not an npm dependency. The `pnpm db:*` scripts run it through
`scripts/run-supabase.mjs`, which stops with install instructions when it is
missing or older than that version (`MIN_CLI_VERSION`, the version
`supabase/config.toml` is tested with). The script also refuses commands that
would seed a hosted project: `pnpm db:seed:buckets --linked`, a hosted
`db reset` without `--no-seed`, and `db push --include-seed`. Add
`--allow-remote-seed` only if you really mean it.

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

### Database checks

```bash
pnpm test:db              # every tests/db/*.test.sql
pnpm test:db -- rls       # only files whose name contains "rls"
pnpm test:db -- --keep    # leave the database running and print how to connect
```

`pnpm test:db` (`scripts/test-db.ts`) checks what the unit tests cannot
reach: tenant isolation under RLS, for the tables and for product images in
Storage; the PowerSync upload RPCs (idempotent retries, void and refund
conflicts, member and tenant checks, device timestamps); and the triggers
(void window, refunds of voided sales, last-write-wins product edits,
revoke-only invitations). Run it after changing `lib/db/schema.ts`, a
migration or a file in `supabase/manual/`. CI does not run it yet.

It creates a throwaway PostgreSQL cluster in a temporary directory, listening
on 127.0.0.1 only, and deletes it afterwards. It applies
`tests/db/supabase-stubs.sql` (the parts of Supabase the SQL relies on: API
roles and grants, `auth.users`, `auth.uid()`, Storage tables), the migrations,
every `supabase/manual/` file twice (each must be safe to re-run) and
`supabase/seed.sql`, then runs each `tests/db/*.test.sql` in a transaction
that it rolls back. It needs neither Docker nor the Supabase stack, and never
reads `DATABASE_URL`. It does need the PostgreSQL server binaries (`initdb`,
`pg_ctl`, `postgres`, `psql`), found through `pg_config` or in `PG_BIN`: for
example `brew install postgresql@17`, or
`PG_BIN=/usr/lib/postgresql/17/bin pnpm test:db` on Debian or Ubuntu. It is
tested with PostgreSQL 18; hosted Supabase projects run 17.

To add a check, write SQL in a new or existing `tests/db/*.test.sql` file with
the helpers in `tests/db/test-helpers.sql`: `tests.authenticate(user_id)` acts
as a signed-in user (or, with `NULL`, as a request with only the publishable
key), and `tests.is`, `tests.ok` and `tests.throws` assert.

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
loads products, sales and stock movements from Supabase on the server and uses
server actions for every write (products, sales, voids, refunds and stock
movements). The sync pill is hidden and no local SQLite store is opened, so
nothing works offline. The draft cart is kept in the browser's localStorage
instead (for up to a day, removed at logout).

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
app only after both, unless the release's upgrade notes give another order.
Vercel deploys on push, and its Preview deployments use staging: apply a
branch's migrations to staging before anyone opens its preview, and to
production before merging it into the production branch. An app that writes
rows the old schema rejects blocks each device's upload queue until the
migration lands.

**Upgrading an environment:** [`docs/upgrade-notes.md`](docs/upgrade-notes.md)
lists, in order, every step staging and then production need for the next
release: database pre-checks, migrations, hand-written SQL, PowerSync sync
rules, Auth settings and email templates, Vercel variables, and the checks to
run after the deploy.

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

Paste them into a hosted project only once the deploy that includes
`app/auth/confirm` and `app/auth/update-password` is live there (staging
first, then production). The templates link to those routes, so pasted
earlier, every sign-up and reset email sent in between links to a page the
running build does not have, and the address stays unconfirmed. Until the
deploy, keep the old templates: `/auth/callback` still handles
`{{ .ConfirmationURL }}` links, so deploying first is safe.

Resend remains the configured SMTP provider; no Auth Hook is required.

The buttons link to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<email|recovery>&next={{ .RedirectTo }}`,
not to `{{ .ConfirmationURL }}`. `app/auth/confirm` verifies the token hash
with `verifyOtp`, which works in any browser. The default link goes through a
PKCE code exchange that needs a cookie only the browser that asked for the
email has, so it failed when the email was opened in the installed iOS app, an
email app's browser or another device. `next` carries the redirect URL the app
sent (`/auth/callback?next=…`), and the confirm route continues to that URL's
`next` path, such as an invitation link. The route accepts only `type=email`
and `type=recovery`.

Because a link works in any browser, whoever holds one can also open it in
someone else's. So a confirmation link does not sign in: the route verifies it
with a client that keeps the session to itself and revokes it, leaves the
browser's cookies (and any session in them) alone, and opens the sign-in
screen with "Tu correo está confirmado", which then continues to `next`.
Otherwise anyone could create an account, keep its unused link, and send it
to a seller whose browser would record sales into that account. A recovery
link does sign in, since the password form needs the session, and always
continues to `/auth/update-password`, which names the account. The app keeps
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
switching/sign-out are blocked, and Diagnostics lists every failed transaction
with its error; **Copiar diagnóstico** exports the complete operation payload.
After the underlying problem is fixed, **Forzar sincronización** retries the
same transaction; a successful atomic commit resolves the failure marker
automatically. When the server will never accept it, **Descartar operación**
(confirmed) removes the transaction from the queue, puts the rows it changed
back to the last server version on the device, keeps the record and payload
as discarded (listed and exported until sign-out), and sends a Sentry event
with metadata only. It pauses sync while it runs, so a retry already in
flight finishes first; if that retry got through, nothing is discarded. Do not clear browser/PWA storage while a failure is
unresolved.

A device whose identity changed (another tenant or account is active) never
clears unsynced work by itself: it uploads it first, or keeps it and shows a
recovery panel that can go back to the previous tenant or sign out. Only when
no tenant is within reach to resolve a failure (the user's membership was
removed, or the queue names no user) does the panel offer to download a copy
and, once confirmed, discard the whole queue; Sentry then gets a
`PowerSync unsynced work discarded on the device` warning with the counts
only.

Two rejections are retried without a failure marker, because they fix
themselves: a permission error while the device has no Supabase session (it
uploads again after sign-in), and a device timestamp more than 5 minutes ahead
of the server clock (Postgres code `55000`). The second one uploads only once
the server clock reaches the stored timestamp minus 5 minutes, and every later
upload from that device waits behind it. Correcting the device clock does not
release rows already queued; it only stops new ones from being held. The
device records the wait in the local-only `upload_holds` table: the sync pill
reads **Hora adelantada**, Settings and More say from when the cloud accepts
the rows, and Diagnostics shows **En espera hasta**. Sentry gets a
`PowerSync upload held by the device clock` warning once a transaction has
waited 10 minutes. Nothing needs discarding; do not clear browser/PWA storage
while it waits.

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
if the claim still differs it logs a console warning ("Supabase session claims
another tenant than the local data") and PowerSync retries later. When the
refreshed token names another tenant, the account's active tenant changed on
another device and only a reload moves this device to it: the sync pill reads
**Puesto cambiado** and reloads when tapped, Settings, More, the join page and
Diagnostics say to reload and offer a button for it, and the download error is
"Tu puesto activo cambió en otro dispositivo". Sign-out and tenant changes wait
for that reload, which uploads pending work first. When the refresh failed or
the claim is missing, Diagnostics shows "La sesión todavía no corresponde al
puesto de este dispositivo" instead, which a reload also fixes.

The app logs nothing else about the token: not the endpoint, nor the JWT's
`alg`, `kid`, `iss` or `aud`. When PowerSync rejects a token (`PSYNC_S2101`,
`PSYNC_S2105`), check those yourself. In the browser's developer tools, copy
the value of the `sb-<project-ref>-auth-token` cookie (when it is split into
`.0`, `.1`… cookies, join their values in order). It holds the session, and
its access token is a live credential, so decode it locally rather than on a
website:

```bash
node -e 'const session = JSON.parse(Buffer.from(process.argv[1].replace(/^base64-/, ""), "base64url")); for (const part of session.access_token.split(".").slice(0, 2)) console.log(JSON.parse(Buffer.from(part, "base64url")))' '<cookie value>'
```

The first object is the JWT header, the second its claims. Compare the
header's `kid` and `alg` with the keys at the JWKS URI, `iss` with
`https://<project-ref>.supabase.co/auth/v1`, `aud` with the accepted audience,
and `app_metadata.tenant_id` with the tenant in Diagnostics.

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

Also pass `--no-seed` when resetting any cloud project — the `supabase/seed.sql` script is local-only (creates a demo auth user with a known password, and assumes `pgcrypto` is enabled). It has no business running against staging or prod. `pnpm db:reset --linked` refuses to run without `--no-seed`.

```bash
supabase db reset --linked --no-seed
```

### QA seed

`pnpm db:seed:qa` creates (or refreshes) a stable QA account on the Supabase project the env vars point at — typically `glitter-finance-staging`. It provisions a dummy catalog (one product with stock tracking and its stock movements), completed sales, a voided sale, and a refunded sale, attached to a fixed tenant id so re-runs are idempotent. The auth user, the tenant and the QA user's membership are always preserved, and other members of the QA tenant are left alone; `--reset` only wipes the catalog, stock movements and sales, in one transaction.

Pass the target credentials inline so the command always runs against the intended project:

```bash
QA_EMAIL=qa@glitterfinance.app QA_PASSWORD=... \
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
pnpm db:seed:qa             # append `-- --reset` to wipe catalog, stock and sales and reseed
```

This script and `pnpm db:invite:tenant-user` take the target, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `DATABASE_URL`, from one place: all three from the command line, or else all three from `.env.local` (then `.env`). A target split between the command line and a file is refused, and so is a `DATABASE_URL` whose host or pooler user names another project than the Supabase URL. Before writing, they print the target (API URL, database user and host, never the secrets). For anything but the local stack they then ask you to type `yes`; pass `--yes` (`pnpm db:seed:qa -- --yes`) to skip the prompt.

### Team members

Members join a tenant through the app: **Más → Ajustes → Equipo** creates a
shareable invitation link (`/join/<token>`) that is valid for 7 days, and the
same card revokes it. Anyone who opens an active link, signs in (or signs up)
and taps **Unirme** joins the tenant, which becomes their active tenant. A
link has no "used" state: it admits everyone who opens it until it expires or
is revoked. The database keeps only a hash of each link's token, and an
encrypted copy so the card can show the link again, both keyed by
`INVITATION_SECRET_KEY` (see [Environment](#environment)). Links are built from
the deployment's public origin (see
[Branch preview URLs](#branch-preview-urls-vercel)).

#### QA: provision a member from the command line

`pnpm db:invite:tenant-user` is a QA convenience, not the way real members
join: it creates (or refreshes) an auth user with a password, inserts its
`tenant_users` row on the target tenant, and sets `app_metadata.tenant_id` so
PowerSync scopes replication to that tenant. Use it to set up test accounts on
staging, reset a test member's password, or backfill a membership without the
UI. It needs an environment whose migrations, manual SQL and sync rules are up
to date (see [Upgrading to the next release](docs/upgrade-notes.md)).

```bash
TENANT_ID=7a000000-0000-4000-8000-000000000001 \
INVITE_EMAIL=helper@glitterfinance.app INVITE_PASSWORD=... \
INVITE_DISPLAY_NAME="Helper Booth" \
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
pnpm db:invite:tenant-user
```

`INVITE_DISPLAY_NAME` is optional. Without it, re-running the script (to reset a password, for example) keeps an existing member's display name, which reports use for their past sales; a new membership takes the user's profile name, or else the email's local part.

After inviting, have the user sign in on their device. Settings → Equipo should list every member; reports should attribute sales by display name once both devices have synced.

### Stage B staging checklist

Before running Stage B acceptance on staging:

- The staging app environment in Vercel has all five required server
  variables (see [Environment](#environment)), including an
  `INVITATION_SECRET_KEY` generated for staging alone.
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
  last one it has had, in order. When unsure, start from an earlier file and
  run every file after it as well, in order. Never re-run an older file on its
  own: some files replace what an earlier one installed, and running the
  earlier one again puts the old version back. File 1 replaces file 7's upload
  policy, and file 5 replaces file 6's upload RPCs and void trigger. The
  verification query below shows both.
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
   product edits are last-write-wins by `updated_at`, column by column: a late
   offline upload no longer overwrites a newer change to the same field, and
   its changes to other fields still apply. A placeholder tone never replaces
   an uploaded image. Every environment, after file 6 and after the
   `pnpm db:push` that adds `products.field_updated_at`.

To check an environment, run in its SQL editor:

```sql
-- Public tables without RLS (expect no rows):
SELECT c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

-- A marker for each file that installs RLS, functions, triggers or Storage
-- rules. Each checks what the file leaves in place, so it also turns false
-- when an older file was re-run over it (expect every column true):
SELECT
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.inventory_movements'::regclass) AS "20260626170000",
  to_regprocedure('public.powersync_create_sale(jsonb,jsonb)') IS NOT NULL
    AS "20260808235900",
  -- File 5's versions of these do not bound device timestamps.
  (SELECT bool_and(coalesce(
      pg_get_functiondef(to_regprocedure(f)) LIKE '%check_upload_timestamp%',
      false))
    FROM unnest(ARRAY[
      'public.powersync_create_sale(jsonb,jsonb)',
      'public.powersync_void_sale(uuid,uuid,timestamptz)',
      'public.powersync_create_refund(jsonb)',
      'public.sales_enforce_void_transition()'
    ]) AS f) AS "20260926120000",
  -- File 1's upload policy checks only the tenant folder.
  (SELECT count(*) = 2 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('tenant members can upload product images',
        'tenant members can delete product images')
      AND coalesce(with_check, qual) LIKE '%product_image_tenant_id%')
    AND EXISTS (SELECT 1 FROM storage.buckets
      WHERE id = 'product-images' AND file_size_limit = 5242880
        AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png']
        AND allowed_mime_types <@ ARRAY['image/jpeg', 'image/png'])
    AS "20260926130000",
  coalesce(pg_get_functiondef(
      to_regprocedure('public.products_keep_latest_edit()')
    ) LIKE '%field_updated_at%', false)
    AND EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgname = 'products_keep_latest_edit'
        AND tgrelid = 'public.products'::regclass)
    AS "20260926130100";
```

Confirm the publication with the queries under [PowerSync setup](#powersync-setup).

### Runtime data access

Server-only code imports `db` from `lib/db/index.ts` for typed reads and writes through Drizzle. `db` connects directly to Postgres, so it bypasses RLS — treat it as a trusted server context and gate access at the application layer: tenant-scoped server actions call `requireExpectedTenantContext` (`lib/auth/user-context.ts`) and pass the resulting tenant id into every query. The Supabase clients in `lib/supabase/` are used for auth and session cookies and for product images in Storage (uploads with the user's session; best-effort cleanup and `app_metadata` updates with the secret key in `admin.ts`), never for product or sales rows.

## Product docs

- [`docs/glitter-finance-prd.md`](docs/glitter-finance-prd.md): the product
  requirements.
- [`docs/glitter-inventory-prd.md`](docs/glitter-inventory-prd.md),
  [`docs/multi-tenant-invitations-prd.md`](docs/multi-tenant-invitations-prd.md)
  and [`docs/dark-mode-prd.md`](docs/dark-mode-prd.md): feature specs.
- [`DESIGN.md`](DESIGN.md): the design system and the implemented component
  specs.
- [`docs/implementation-notes.md`](docs/implementation-notes.md): how the code
  is put together, and known follow-ups.
- [`docs/upgrade-notes.md`](docs/upgrade-notes.md): what each environment needs
  when the next release is deployed.
- [`docs/stage-b-acceptance.md`](docs/stage-b-acceptance.md),
  [`docs/stage-d-acceptance.md`](docs/stage-d-acceptance.md) and
  [`docs/sync-atomicity-acceptance.md`](docs/sync-atomicity-acceptance.md):
  real-device acceptance scripts.
- [`docs/production-observability.md`](docs/production-observability.md):
  Sentry and uptime setup.
