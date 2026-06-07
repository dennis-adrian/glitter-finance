# Glitter POS — Project Instructions

## Migrations

- Never manually create, rename, edit, or delete files in `supabase/migrations/`
  or `supabase/migrations/meta/` (including `_journal.json` and snapshots).
  Migration files and their metadata are managed exclusively by the Drizzle Kit
  CLI (`npm run db:generate`). Hand-editing them causes schema/snapshot/journal
  drift.
- The only exception is hand-written SQL migrations for things Drizzle cannot
  model (RLS policies, `auth.users` foreign keys, grants, triggers) — and only
  when explicitly instructed.
