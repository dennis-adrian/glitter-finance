# Billetera Ferial — Project Instructions

## Migrations

- **`lib/db/schema.ts` is the source of truth** for everything Drizzle can
  model: tables, columns, enums, indexes, foreign keys (within `public`),
  `CHECK` constraints, and partial unique indexes. Declare it there and run
  `pnpm db:generate` — do not add the same DDL in hand-written SQL.
- Never manually create, rename, edit, or delete **Drizzle-generated** files in
  `supabase/migrations/` or `supabase/migrations/meta/` (including
  `_journal.json` and snapshots). Hand-editing them causes schema/snapshot/journal
  drift.
- The only exception is **hand-written SQL** for things Drizzle cannot model:
  RLS policies, `auth.users` foreign keys, storage policies, grants, triggers,
  `ALTER PUBLICATION`, and idempotent one-off data backfills that must run in
  the same transaction as the manual triggers they depend on. Put these under
  `supabase/manual/` with a `YYYYMMDDHHMMSS_description.sql` timestamp prefix
  (same ordering idea as Drizzle migrations). They are run in the SQL editor
  after `db:push`, in lexicographic order — not tracked in
  `supabase/migrations/meta/`. Make each file idempotent (`pnpm db:reset` runs
  them all, and `pnpm test:db` runs them twice), and never edit one that has
  shipped to an environment: fix forward with a new file.
- **One sanctioned exception:**
  `supabase/migrations/20260628210000_tenant_invitations_rls.sql` is
  hand-written SQL (`auth.users` FKs, `tenant_invitations` RLS and its
  revoke-only trigger) that shipped in `supabase/migrations/`, outside the
  Drizzle journal. `db:push` applies it and every environment's migration
  history records it, so leave it where it is: moving or renaming it breaks
  `db:push` on those environments. It is not a precedent; new hand-written SQL
  always goes in `supabase/manual/`.

## Upgrade notes

- When a change needs a step in staging or production (a migration or its
  pre-check, a `supabase/manual/` file, a sync rules redeploy, a hosted Auth
  setting or email template, a Vercel variable, a post-deploy check), add it
  to `docs/upgrade-notes.md` in the same change, in deploy order.

## UI copy

- User-facing Spanish (UI, errors, toasts, emails) uses **voseo**
  ("Confirmá", "Ingresá", "Tenés"), never tuteo. The tenant is a **"puesto"**;
  "cuenta" only means the user's own login account.
  `tests/ui-copy-voice.test.ts` enforces both.

## Next.js agent rules

- `next dev` writes the `nextjs-agent-rules` block below into `AGENTS.md`
  (`node_modules/next/dist/server/lib/generate-agent-files.js`). Keep it:
  whenever it appears or changes in the working tree, commit it with your
  change instead of reverting it, and copy the same block into `CLAUDE.md`
  so both files stay in sync.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
