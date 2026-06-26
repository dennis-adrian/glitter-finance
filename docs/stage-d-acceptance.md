# Stage D Acceptance: Multi-User And tenant_users Replication

Stage D is accepted only after `tenant_users` replicates correctly to devices and
per-user attribution works in reports. A partial deploy (schema without
publication, publication without sync rules, or sync rules without the app
client schema) produces subtle failures — empty Equipo, persistent sync warnings,
or generic `"Vendedor"` names — rather than hard errors.

## Deploy checklist (all required per environment)

Apply every step against the target Supabase project and matching PowerSync
instance before manual QA:

1. **Schema** — `npm run db:push` includes the `tenant_users.id` migration.
2. **Publication** — `tenant_users` is in the `powersync` publication:

   ```sql
   SELECT tablename FROM pg_publication_tables
   WHERE pubname = 'powersync' AND tablename = 'tenant_users';
   ```

3. **Sync rules** — [`powersync/sync-rules.yaml`](../powersync/sync-rules.yaml)
   is validated and deployed in PowerSync Cloud (includes `tenant_users` stream).
4. **App** — staging build includes client schema + `tenant_users` watch.

`NEXT_PUBLIC_POWERSYNC_URL` must point at the PowerSync instance wired to the
same Supabase project as the app env vars.

## Setup

- Complete the deploy checklist above on `glitter-finance-staging`.
- Seed QA: `npm run db:seed:qa`.
- Invite a second member on the QA tenant:

  ```bash
  TENANT_ID=7a000000-0000-4000-8000-000000000001 \
  INVITE_EMAIL=... INVITE_PASSWORD=... \
  NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
  npm run db:invite:tenant-user
  ```

- Install the staging PWA on two devices (iPhone Safari + Android Chrome).

## tenant_users row count

1. Sign in as the QA primary user on device A; wait for synced state.
2. Open **Ajustes → Equipo**. Confirm:
   - Every expected member is listed (count matches server).
   - The “Sincronizando el equipo…” warning is **not** shown once sync completes.
3. On device A, open **Reportes → Por vendedor** and confirm display names (not
   `"Vendedor"`) for sales rung up by each member.
4. Sign in as the invited user on device B; repeat steps 1–3.

**Server verification** (optional, against staging Postgres):

```sql
SELECT count(*) FROM tenant_users
WHERE tenant_id = '7a000000-0000-4000-8000-000000000001';
```

The Equipo list count on each device should match this number after sync. If the
warning persists or names stay generic while other tables sync, re-check
publication and sync rules — local `tenant_users` is empty or partial.

## Cross-device sales

1. Device A records a sale while online.
2. Device B waits for synced state.
3. Device B shows the sale in recent history with the correct seller name.

## Acceptance gate

Stage D passes when the scripts above succeed on both iPhone Safari and Android
Chrome installed PWAs. Record device model, OS/browser version, tester, date, and
any deviations in QA notes.
