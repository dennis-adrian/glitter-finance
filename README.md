# Glitter POS

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

```bash
npm install
npm run db:start
npm run db:reset
npm run db:seed:buckets
npm run dev
```

Then open `http://localhost:3000`.

`npm run db:reset` loads `supabase/seed.sql`, which creates a reusable
development account:

- Email: `demo@glitter-pos.local`
- Password: `glitter-demo`

The seeded account includes a demo tenant, active and archived products, a few
product images from `supabase/product-images/seed`, recent sales, a voided sale,
and a refunded sale for report/history testing.

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_POWERSYNC_URL`
- `SUPABASE_SECRET_KEY`
- `DATABASE_URL`

`DATABASE_URL` should point at the Supabase Transaction Pooler (port `6543`). The runtime Drizzle client in `lib/db/index.ts` is configured with `prepare: false` to be compatible with it.

## Cloud environments

Two Supabase cloud projects back this app:

- **`glitter-finance-staging`** — free plan. Used for branch testing, schema experiments, and QA validation. Safe to wipe.
- **`glitter-finance`** — Pro plan ($25/mo). Production. Migrations land here only after they pass on staging.

Only one project can be linked to the local checkout at a time. A developer relinks via the Supabase CLI when switching contexts:

```bash
# Working on a branch — point at staging:
supabase link --project-ref <staging-project-ref>
npm run db:push       # applies pending migrations to glitter-finance-staging

# Ready to deploy — point at prod:
supabase link --project-ref <prod-project-ref>
npm run db:push       # applies the same migrations to glitter-finance
```

After relinking, update `.env.local` so `NEXT_PUBLIC_SUPABASE_URL`, the publishable and secret keys, and `DATABASE_URL` all match the now-linked project; otherwise the running app and the CLI will talk to different backends.

### PowerSync setup

One-time bootstrap, run once per Supabase project that PowerSync Cloud will connect to (currently `glitter-finance-staging`, and `glitter-finance` once we deploy there). Not run via `db:push` because the role credential must be different per environment and should never live in git.

In the target project's Supabase dashboard, open the SQL editor and run:

```sql
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '<per-env-secret>';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
CREATE PUBLICATION powersync FOR TABLE products, sales, sale_lines, refunds, tenant_users;
```

Notes:

- Generate a fresh `<per-env-secret>` for each environment (e.g. `openssl rand -base64 32`) and store it in a password manager. Do not reuse across staging and prod.
- The role has `REPLICATION BYPASSRLS` — it can read every row in every tenant, bypassing RLS. Treat the credential like a service-role key.
- The publication is targeted at exactly the five synced tables. When adding a new synced table later, run `ALTER PUBLICATION powersync ADD TABLE <name>` against each environment.
- **Existing environments (Stage D):** if `powersync` was created before `tenant_users` was added to the table list above, run [`supabase/manual/powersync-add-tenant-users-to-publication.sql`](supabase/manual/powersync-add-tenant-users-to-publication.sql) in the SQL editor after `npm run db:push`. It is idempotent and skips quietly when the publication is missing (e.g. local `db:reset` before bootstrap).
- Verify: `SELECT pubname FROM pg_publication;` should list `powersync`. Confirm `tenant_users` is published: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'tenant_users';`. Once PowerSync Cloud connects, a row appears in `SELECT * FROM pg_replication_slots;`.

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
   `PSYNC_S2302 No sync config available`.
6. **App environment.** Grab the instance URL from the PowerSync dashboard
   (typically `https://<id>.powersync.journeyapps.com`) and set it as
   `NEXT_PUBLIC_POWERSYNC_URL` in the matching app environment (`.env.local`
   locally, Vercel Production/Preview for deployed apps). Redeploy after
   changing any `NEXT_PUBLIC_*` variable because it is baked into the browser
   bundle.

PowerSync auth and app auth must point at the same Supabase project. At runtime
the app logs safe diagnostics from `lib/powersync/connector.ts`: the PowerSync
endpoint host, whether the JWT has `app_metadata.tenant_id`, and the JWT
metadata (`alg`, `kid`, issuer, audience). The `issuer` must match the Supabase
project used for the JWKS URI, and the `kid` must appear in that JWKS response.

**After `supabase db reset --linked`:** the reset drops everything in the `public` schema, which includes the `powersync` publication and the grants you gave `powersync_role`. The role itself survives (it's cluster-level, not database-level), and its password is unchanged. To restore the replication bits, re-run just the grants + publication portion (skip `CREATE ROLE`):

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
CREATE PUBLICATION powersync FOR TABLE products, sales, sale_lines, refunds, tenant_users;
```

Also pass `--no-seed` when resetting any cloud project — the `supabase/seed.sql` script is local-only (creates a demo auth user with a known password, and assumes `pgcrypto` is enabled). It has no business running against staging or prod.

```bash
supabase db reset --linked --no-seed
```

### QA seed

`npm run db:seed:qa` creates (or refreshes) a stable QA account on the Supabase project the env vars point at — typically `glitter-finance-staging`. It provisions a dummy catalog, completed sales, a voided sale, and a refunded sale, attached to a fixed tenant id so re-runs are idempotent. The auth user and tenant are always preserved; `--reset` only wipes the catalog and sales.

Pass the target credentials inline so the command always runs against the intended project:

```bash
QA_EMAIL=qa@glitterfinance.app QA_PASSWORD=... \
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
npm run db:seed:qa             # append `-- --reset` to wipe catalog + sales and reseed
```

### Invite a tenant member (Stage D)

During closed testing, additional booth helpers are provisioned manually — not through in-app invite UI. `npm run db:invite:tenant-user` creates (or refreshes) an auth user, inserts a `tenant_users` row on the target tenant, and sets `app_metadata.tenant_id` so PowerSync scopes replication correctly.

Before inviting:

1. Apply pending migrations (`npm run db:push`) so `tenant_users.id` exists, then run [`supabase/manual/powersync-add-tenant-users-to-publication.sql`](supabase/manual/powersync-add-tenant-users-to-publication.sql) if the environment predates Stage D (see PowerSync setup notes).
2. Redeploy updated sync rules from `powersync/sync-rules.yaml` in PowerSync Cloud.

Then invite the helper:

```bash
TENANT_ID=7a000000-0000-4000-8000-000000000001 \
INVITE_EMAIL=helper@glitterfinance.app INVITE_PASSWORD=... \
INVITE_DISPLAY_NAME="Helper Booth" \
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
npm run db:invite:tenant-user
```

After inviting, have the user sign in on their device. Settings → Equipo should list every member; reports should attribute sales by display name once both devices have synced.

### Stage B staging checklist

Before running Stage B acceptance on staging:

- Supabase migrations are applied to `glitter-finance-staging`.
- `powersync_role` exists with a per-environment password stored outside git.
- The `powersync` publication includes `products`, `sales`, `sale_lines`, `refunds`, and `tenant_users`.
- PowerSync Client Auth uses the staging Supabase JWKS URI and accepts JWT audience `authenticated`.
- PowerSync sync rules from `powersync/sync-rules.yaml` are validated, deployed, and scoped by the authenticated tenant.
- `NEXT_PUBLIC_POWERSYNC_URL` points at the staging PowerSync instance.
- The QA account is seeded with `npm run db:seed:qa`.
- The installed PWA has been launched once online and the sync pill has reached the synced state before offline relaunch testing.

See [`docs/stage-d-acceptance.md`](docs/stage-d-acceptance.md) for multi-user /
`tenant_users` replication verification after Stage D deploys.

## Drizzle and Supabase: who owns what

Drizzle and Supabase both touch the database, but they sit at different points in the stack. Keeping that split clear avoids confusion when reading the codebase or running migration commands.

### Drizzle owns the schema and typed queries

- **Schema source of truth.** `lib/db/schema.ts` is hand-written in TypeScript. Every table, column, index, relation, and enum is defined there.
- **Typed query layer.** Server-side code reads and writes through `db` from `lib/db/index.ts`. The types flow directly from `schema.ts` with no codegen step.
- **Client-side reuse.** PowerSync uses the client schema in `lib/db/client-schema.ts` to type and materialize the per-device SQLite store. Server-only tables stay in `schema.ts`; local-only device state such as the draft cart lives only in the client schema.
- **Schema-to-SQL diffing.** `drizzle-kit generate` reads the schema, diffs it against the snapshots in `supabase/migrations/meta/`, and writes a new timestamp-prefixed SQL file into `supabase/migrations/`.

Drizzle does **not** apply migrations in this project, and does **not** own the journal that tracks which migrations have run. Those are Supabase CLI concerns.

### Supabase CLI owns migration application and the dev environment

- **Migration runner.** `supabase db push` applies the SQL files in `supabase/migrations/` against the linked cloud project, tracked in `supabase_migrations.schema_migrations`. `supabase db reset` rebuilds the local database from migrations + seed.
- **Local development stack.** `supabase start` boots Postgres, Auth, Storage, and the rest of the stack locally via Docker. The project is initialized via `supabase/config.toml`.
- **Things Drizzle cannot model.** RLS policies, `auth.users` foreign keys, `SECURITY DEFINER` functions, triggers, and grants are hand-written SQL files in `supabase/migrations/`, sitting next to the Drizzle-generated ones. The CLI applies them all in lexicographic (timestamp) order — the file's origin does not matter to the runner.

### Daily commands

```bash
# Edit lib/db/schema.ts, then:
npm run db:generate     # drizzle-kit generate — writes a new SQL file into supabase/migrations/

# Apply migrations:
npm run db:push         # supabase db push — apply to the linked cloud project
npm run db:reset        # supabase db reset — wipe and replay locally

# Local dev stack:
npm run db:start        # supabase start
npm run db:stop         # supabase stop
```

Do not run `drizzle-kit migrate`. The Drizzle `__drizzle_migrations` journal is not maintained; `supabase_migrations.schema_migrations` is the only journal that matters.

### Hand-written SQL migrations

For anything Drizzle's schema cannot express (RLS, auth FKs, triggers, grants), create a new file in `supabase/migrations/` with a fresh timestamp prefix. Example:

```bash
touch supabase/migrations/$(date -u +%Y%m%d%H%M%S)_my_change.sql
```

These files are first-class migrations and are applied by `supabase db push` alongside Drizzle-generated ones. PowerSync publication changes are **not** migrations — they live under `supabase/manual/` and are run in the SQL editor (see PowerSync setup).

### Runtime data access

Server-only code imports `db` from `lib/db/index.ts` for typed reads and writes through Drizzle. `db` connects directly to Postgres, so it bypasses RLS — treat it as a trusted server context and gate access at the application layer (see `lib/auth/user-context.ts` for the tenant scoping pattern). The `@supabase/ssr` clients in `lib/supabase/` are used for auth and session cookies, not for product/sales data.

## Product docs

The PRD lives in [`docs/glitter-finance-prd.md`](docs/glitter-finance-prd.md).
