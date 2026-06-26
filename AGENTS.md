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
- The only exception is **hand-written SQL migrations** for things Drizzle
  cannot model: RLS policies, `auth.users` foreign keys, storage policies,
  grants, triggers, and `ALTER PUBLICATION` (those live under `supabase/manual/`
  when not migration-replayable).
