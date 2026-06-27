# Glitter POS — Project Instructions

## Migrations

- **`lib/db/schema.ts` is the source of truth** for everything Drizzle can
  model: tables, columns, enums, indexes, foreign keys (within `public`),
  `CHECK` constraints, and partial unique indexes. Declare it there and run
  `npm run db:generate` — do not add the same DDL in hand-written SQL.
- Never manually create, rename, edit, or delete **Drizzle-generated** files in
  `supabase/migrations/` or `supabase/migrations/meta/` (including
  `_journal.json` and snapshots). Hand-editing them causes schema/snapshot/journal
  drift.
- The only exception is **hand-written SQL** for things Drizzle cannot model:
  RLS policies, `auth.users` foreign keys, storage policies, grants, triggers,
  and `ALTER PUBLICATION`. Put these under `supabase/manual/` with a
  `YYYYMMDDHHMMSS_description.sql` timestamp prefix (same ordering idea as
  Drizzle migrations). They are run in the SQL editor after `db:push`, in
  lexicographic order — not tracked in `supabase/migrations/meta/`.
