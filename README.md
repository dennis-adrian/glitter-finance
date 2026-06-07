# Glitter POS

Offline-first point-of-sale PWA for Bolivian festival vendors.

This repository currently implements the Stage A product slice from the PRD:

- Product catalog with categories, optional cost, archive/restore, and graceful image placeholders.
- Sell Mode as the default screen with tappable product grid, quantity badges, draft cart persistence, and a fixed Cobrar action.
- Cart review surface with quantity controls and clear-cart.
- Payment screen with sale-level discounts and cash/QR checkout.
- Immutable local sales with snapshotted price/cost data, recent sales, voids, refunds, and basic reports.
- Local persistence using browser storage through Zustand, ready to be replaced by PowerSync-backed SQLite.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `DATABASE_URL`

`DATABASE_URL` should point at the Supabase Transaction Pooler (port `6543`). The runtime Drizzle client in `lib/db/index.ts` is configured with `prepare: false` to be compatible with it.

## Drizzle and Supabase: who owns what

Drizzle and Supabase both touch the database, but they sit at different points in the stack. Keeping that split clear avoids confusion when reading the codebase or running migration commands.

### Drizzle owns the schema and typed queries

- **Schema source of truth.** `lib/db/schema.ts` is hand-written in TypeScript. Every table, column, index, relation, and enum is defined there.
- **Typed query layer.** Server-side code reads and writes through `db` from `lib/db/index.ts`. The types flow directly from `schema.ts` with no codegen step.
- **Client-side reuse (planned).** When PowerSync is wired in, `@powersync/drizzle-driver` will reuse the same `schema.ts` to type queries against the per-device SQLite store. The schema lives in one place and types both ends.
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

These files are first-class migrations and are applied by `supabase db push` alongside Drizzle-generated ones.

### Runtime data access

Server-only code imports `db` from `lib/db/index.ts` for typed reads and writes through Drizzle. `db` connects directly to Postgres, so it bypasses RLS — treat it as a trusted server context and gate access at the application layer (see `lib/auth/user-context.ts` for the tenant scoping pattern). The `@supabase/ssr` clients in `lib/supabase/` are used for auth and session cookies, not for product/sales data.

## Product docs

The PRD lives in [`docs/glitter-finance-prd.md`](docs/glitter-finance-prd.md).
