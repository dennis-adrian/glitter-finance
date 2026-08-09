# Glitter Finance — Multi-Tenant Membership & Invitations PRD

**Author:** Adrian Guzman (with Claude)
**Status:** Draft v1
**Date:** June 2026
**Related:** `docs/glitter-finance-prd.md` (tenants, RLS, PowerSync), `docs/glitter-inventory-prd.md` §3.2 (multi-user-on-one-tenant model), `scripts/invite-tenant-user.ts` (the CLI flow this supersedes)

---

## 1. Overview

Two related capabilities, built on one model change:

1. **Shareable invitations.** Any member of a tenant can generate an invitation
   **link**, copy it, and send it through any channel (email, WhatsApp, etc.).
   Whoever opens the link signs in with **their own** credentials and is added to
   the tenant as a member. No CLI, no admin-set passwords, no email-bound magic
   links.

2. **One login, many tenants.** A single user account can belong to several
   tenants at once and switch between them in the app. The motivating case: one
   person runs several booths at a festival (each a separate business/tenant),
   has helpers who register sales, and wants every booth and every helper reached
   from one set of credentials.

The enabling change is to stop treating "the user's tenant" as a single fixed
value and treat it as **one active tenant chosen from many memberships**. The
database already models membership as a many-to-many join (`tenant_users`); the
single-tenant assumption lives entirely in the layers above it. This document
specifies the schema additions, the active-tenant model, the invitation/redeem
flow, the tenant-switch flow, security, and acceptance criteria.

### Roles (explicitly out)

There are **no roles** in this release. Every member of a tenant has identical
permissions — effectively all members are admins. Any owner/seller labels shown
in the Settings UI are **presentation-only** and do not introduce permission
differences. The one piece of ownership we _do_ record is **who created the
tenant** (`tenants.created_by_user_id`), stored only for future features
(billing, "owner can delete tenant", role introduction). That field grants no
special permission today; all members still have identical permissions.

## 2. Goals and Non-Goals

**Goals**

- A member can generate a shareable invitation **link** to their tenant from the
  UI, copy it in one tap, and revoke it.
- An invitation link is **reusable until revoked** and **auto-expires** after a
  fixed window. Multiple people can join with the same link while it is valid.
- Opening a valid link, then signing in or signing up, adds that user to the
  tenant and drops them into it.
- A user can belong to **multiple tenants** and **switch** the active one from
  the UI; the app re-scopes all data to the chosen tenant.
- A user can **create additional tenants** ("new booth/account") under the same
  login.
- Record **who created each tenant**.
- Everything stays correct under the existing PowerSync per-device, per-tenant
  sync model.

**Non-Goals (this release)**

- **Roles / differentiated permissions.** All members are equal. `created_by`
  is recorded but unused for authz.
- **Removing members / leaving a tenant.** Read-only member list stays; member
  removal is a fast follow (see Open Items), not in this cut.
- **Deleting a tenant.**
- **Simultaneous multi-tenant view.** One active tenant per device at a time;
  switching re-syncs. No merged cross-tenant reports.
- **Email delivery of invitations.** We produce a link; the user sends it. No
  transactional email, no `inviteUserByEmail`.
- **Per-invitation seat limits or named-invitee binding.** A link is a tenant
  join secret, not tied to a specific email address.

## 3. Current State (Analysis)

What already exists and is reusable:

- **`tenant_users` is already a many-to-many join** (`lib/db/schema.ts`):
  single-column `id` PK (PowerSync requirement), `unique(tenant_id, user_id)`,
  indexed on both `user_id` and `tenant_id`. The DB can already represent a user
  in many tenants and a tenant with many users.
- **RLS is already membership-based, not claim-based.**
  `current_user_has_tenant(tenant_id)` consults `tenant_users` for `auth.uid()`
  (`supabase/migrations/...rls_policies.sql`). So Postgres already authorizes a
  user across _every_ tenant they belong to — multi-tenant authz needs **no RLS
  change**.
- **Server reads run on a trusted Drizzle connection.** Repositories
  (`lib/products/repository.ts`, etc.) and `lib/auth/*` query via `lib/db` over
  `DATABASE_URL`, which is not the `authenticated` PostgREST role, so they are
  not RLS-bound and scope by `tenant_id` explicitly. Invitation reads/writes will
  use this same trusted path.
- **A CLI invite already wires the mechanics** (`scripts/invite-tenant-user.ts`):
  create/find the auth user, ensure a `tenant_users` row, set the tenant claim.
  We reuse the _membership_ and _claim_ mechanics and drop the rest.
- **PowerSync clear/reconnect controls exist.** `usePowerSyncControls()` exposes
  `clearLocal()` (`disconnectAndClear`) and `reconnect()`
  (`components/providers/powersync-provider.tsx`) — already used by sign-out. The
  tenant switch reuses exactly these.
- **The auth callback already supports a safe `next` round-trip**
  (`app/auth/callback/route.ts`, `sanitizeRedirectPath`).

What is hard-coded single-tenant and must change:

- **`app_metadata.tenant_id` is a single scalar claim.** It is written by
  `ensureAppMetadataTenantId` (`lib/auth/user-context.ts`) and read by the
  PowerSync sync rules (`powersync/sync-rules.yaml`) and the connector
  (`lib/powersync/connector.ts`). This claim becomes the **active** tenant — kept
  single-valued (PowerSync scopes one tenant per connection) but now _mutable_ on
  switch.
- **`loadMembership()` does `.limit(1)`** (`lib/auth/user-context.ts:31`) —
  arbitrarily picks one membership and ignores the rest. Must load _all_
  memberships and resolve the active one.
- **The bootstrap path auto-creates a tenant** for any user with no membership.
  Correct for an organic first sign-up (their first booth), but it must **not**
  fire for a user who is mid-invite-redemption (that user's tenant is the one
  they were invited to, not a fresh personal one).
- **The CLI script forbids multi-tenant** outright:
  `assertUserCanJoinTenant` throws "Remove that membership first before inviting
  to another tenant." This guard is removed.
- **Settings is single-tenant and read-only**
  (`components/screens/settings-screen.tsx`): shows one account header and a
  members list with the note "members are added by manual invitation during
  closed testing." It gains the switcher, the create-account action, and the
  invite-link card.

## 4. Domain Model Additions

### 4.1 `tenants.created_by_user_id`

A new `uuid` column on `tenants` recording the creator.

- Declared in `lib/db/schema.ts` as a plain `uuid` (Drizzle cannot model the
  `auth.users` foreign key); **nullable** so existing rows and the
  Drizzle-generated migration don't need a backfill default.
- The `auth.users` FK (`ON DELETE SET NULL`) is added in hand-written SQL under
  `supabase/manual/` (§6.2), matching the project rule for `auth.users` FKs.
- Set in **both** tenant-creation paths: the sign-in bootstrap
  (`ensureUserTenantContext`) and the new explicit `createTenant` action.
- No permission is derived from it in this release.

### 4.2 `tenant_invitations` (new table, server-side only — **not synced**)

One row per shareable invitation link.

| Field                       | Type                      | Notes                                                                                                                                                                               |
| --------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid PK                   | `defaultRandom()`.                                                                                                                                                                  |
| `tenant_id`                 | uuid                      | FK → `tenants(id) ON DELETE cascade`. The tenant the link joins.                                                                                                                    |
| `token`                     | text, **unique**          | HMAC-SHA256 hash of the raw bearer token (§7.1). Used for redeem lookup only; the raw secret is never stored in plaintext.                                                          |
| `token_delivery_ciphertext` | text, nullable            | AES-256-GCM ciphertext of the raw bearer token, encrypted with a server-held key. Enables re-display of the active link in Settings; nullable for legacy rows that must be rotated. |
| `created_by_user_id`        | uuid, nullable            | FK → `auth.users` (hand-written, `ON DELETE SET NULL`). Who generated the link; nulled if that auth user is later deleted.                                                          |
| `expires_at`                | timestamptz, **not null** | Hard expiry. Default window in §5.1.                                                                                                                                                |
| `revoked_at`                | timestamptz, nullable     | Set when revoked. `NULL` = active.                                                                                                                                                  |
| `created_at`                | timestamptz, not null     | `defaultNow()`.                                                                                                                                                                     |

- **No per-acceptance columns.** Because the link is reusable, the record of
  _who joined_ is the `tenant_users` rows themselves — there is no single
  "accepted_by". An invitation is a long-lived, revocable join secret.
- **Validity predicate:** `revoked_at IS NULL AND expires_at > now()`.
- Indexes: `unique(token)` (lookup on redeem) and an index on `tenant_id` (list
  a tenant's invitations in Settings).
- **This table is never replicated to devices.** Like `tenants`, it is read and
  written only server-side (Settings server action + the join flow). It must
  **not** be added to the PowerSync publication or `sync-rules.yaml` (§6.4).
- Declared in `lib/db/schema.ts` (table, indexes, `tenant_id` FK to `tenants`).
  The `auth.users` FK on `created_by_user_id` is hand-written (§6.2). **No
  client-schema entry** in `lib/db/client-schema.ts` (it does not sync).

### 4.3 No new role column

Stated for emphasis: `tenant_users` is unchanged except in how it is _read_
(all memberships, not one). No `role`, no `is_admin`.

## 5. Functional Requirements

### 5.1 Generating and revoking an invitation

In **Settings**, a member sees an "Invitar al equipo" card for the active tenant:

- **No active link yet:** a "Generar enlace de invitación" button. Pressing it
  runs the `createInvitation` server action, which inserts a `tenant_invitations`
  row (`expires_at = now() + DEFAULT_INVITE_TTL`) and returns the link
  `${origin}/join/${token}`.
- **Active link present:** show the link, a **Copiar** button (Clipboard API), a
  native **Compartir** button (Web Share API, where supported), the expiry
  ("Caduca …"), and a **Revocar** button (with a confirm step). Revoking sets
  `revoked_at`; the card returns to the generate state. Generating again issues a
  fresh token.
- **The active link persists across sessions when recoverable.** On opening
  Settings, the tenant's current valid invitation is server-loaded
  (`getActiveInvitationForTenant` → `initialInvitation`) and rendered when the
  encrypted delivery ciphertext can be decrypted. The raw bearer token is shown
  only at creation time; later sessions re-display the same link only when
  `token_delivery_ciphertext` is present. If an active row exists but the raw
  token cannot be recovered (legacy row or missing ciphertext), the card prompts
  the member to **revoke and regenerate** rather than silently rotating the link.
- `createInvitation` reuses the single active invitation when one exists; it does
  **not** implicitly revoke and replace an active link when the bearer token is
  unavailable.
- The link is plain text — shareable by pasting into email, WhatsApp, etc. There
  is no email step.
- **Reuse semantics:** while valid, the link admits _any number_ of users.
  Revoke (or expiry) cuts it off. This is the WhatsApp-group-invite model and is
  intentional; it is documented in the card's helper copy ("Cualquiera con este
  enlace puede unirse hasta que lo revoques o caduque").

`DEFAULT_INVITE_TTL` is a single constant (recommend **7 days**; §13).

### 5.2 Redeeming an invitation — `/join/[token]`

A new route `app/join/[token]/page.tsx`:

1. Server-loads the invitation by `token` via the trusted Drizzle connection and
   validates it (exists, `revoked_at IS NULL`, `expires_at > now()`).
   - Invalid/expired/revoked/unknown → a friendly "Esta invitación ya no es
     válida" screen with a link to the app. No tenant details leaked.
2. **Not authenticated** → redirect to `/login?next=/join/${token}`. After the
   user signs in or signs up, the auth flow returns them here (§5.5).
3. **Authenticated** → show "Unirte a _{tenant name}_" with an **Unirme**
   button. Pressing it runs the `acceptInvitation` server action:
   - Re-validate the invitation server-side (defense against a stale page).
   - **Idempotent membership upsert:** if the user is already a member, no-op;
     otherwise insert a `tenant_users` row with a `display_name` derived from
     their profile (reuse the `getDisplayName` logic in
     `lib/auth/user-context.ts`).
   - **Set this tenant active** (write `app_metadata.tenant_id`, §5.3) and
     redirect into the app. The membership row already exists before Home runs,
     so the bootstrap auto-create cannot fire for this user (§5.6).

The new `tenant_users` row replicates to the tenant's other devices through the
existing `tenant_users` sync stream, so the member appears in everyone's team
list with no extra wiring (same mechanism as the inventory PRD §3.2).

### 5.3 Active tenant — the model change

`app_metadata.tenant_id` is redefined from "the user's tenant" to "the user's
**active** tenant," chosen from their memberships:

- **`ensureUserTenantContext` resolves the active tenant from all memberships.**
  Replace the `.limit(1)` lookup with: load every `tenant_users` row for the
  user (joined to `tenants`); pick the active one as **the membership whose
  `tenant_id` equals the current claim, if still valid; otherwise the first by
  `created_at`**. If the claim is stale (points at a tenant the user has left or
  that no longer exists) or absent, fall back and re-write the claim to the
  resolved tenant.
- **`UserTenantContext` gains the membership list** so the UI can render the
  switcher: add `tenants: { id, name }[]` (all memberships) alongside the
  existing active `tenant`. `app/page.tsx` continues to fetch domain data for the
  **active** tenant only.
- The bootstrap (first-ever sign-in, zero memberships) is unchanged except it now
  also sets `created_by_user_id` and there is exactly one membership, which is
  active.

### 5.4 Switching tenants

In **Settings**, a tenant switcher lists the user's memberships with the active
one marked, plus a "Crear nueva cuenta" entry.

Selecting a different tenant runs `switchTenant(tenantId)`:

1. **Server action:** assert the user is a member of `tenantId` (membership
   check), then write `app_metadata.tenant_id = tenantId` via the admin client.
2. **Client orchestration** (the switcher is a client component, like sign-out):
   - **Precondition — sync settled:** switching is hard-blocked unless the
     client is fully synced with **zero** pending uploads. The switcher gates on
     the existing sync-status signal (`useSyncStatus` —
     `state === "synced" && pendingCount === 0`) and the buttons stay disabled
     otherwise. This runs _before_ `clearLocal()`, because clearing wipes the
     upload queue — switching mid-flush would silently drop the previous
     tenant's unsynced writes.
   - `await powerSyncControls.clearLocal()` — wipe the previous tenant's local
     SQLite + upload queue (must happen while the connection is live, exactly as
     sign-out does).
   - Refresh the Supabase session so the JWT carries the new claim
     (`supabase.auth.refreshSession()`), mirroring the connector's existing
     refresh-on-missing-claim logic.
   - Force the server components to re-fetch for the new active tenant
     (`router.refresh()` or a full reload of `/`). PowerSync re-connects via the
     provider with the new claim and re-syncs the new tenant's data.

This is the **same clear-then-reconnect dance as sign-out**
(`handleSignOut` → `clearLocal` → ...), only it stays signed in and points the
claim at a different tenant. One tenant's data is resident per device at a time;
switching is a deliberate re-sync, not a merge.

> **Guardrail:** never PATCH a record after a switch without a completed
> `clearLocal`. A half-cleared store would upload rows under the wrong tenant
> claim. The switch action must `await clearLocal()` before the session refresh.

### 5.5 Auth flow carries `next`

`signInWithPassword` / `signUpWithPassword` (`app/auth/actions.ts`) must
propagate a `next` param so an invited user returns to `/join/{token}`:

- The login page reads `next` from `searchParams` and renders it as a hidden
  field in both forms; the actions read it, sanitize it (reuse
  `sanitizeRedirectPath` from the callback route), and `redirect(next)` instead
  of the hardcoded `/`.
- **Sign-in with a `next=/join/...`:** do **not** run the bootstrap
  auto-create; redirect straight to the join page, which performs the
  membership + active-tenant work.
- **Sign-up with a pending invite:** if email confirmation is required (no
  session returned), the confirmation email's redirect already flows through
  `app/auth/callback` with `next` preserved → lands on the join page. If a
  session is returned immediately, redirect to the join page directly. In neither
  case do we bootstrap a personal tenant for an invite-only signup (§5.6).

### 5.6 Bootstrap must not collide with invite redemption

The auto-create-a-tenant bootstrap fires only when a user has **zero
memberships**. A brand-new user redeeming an invite briefly has zero memberships
between sign-up and the `acceptInvitation` action. To avoid minting a stray
personal tenant for them:

- The invite path **skips the bootstrap** (sign-in/sign-up with `next=/join/...`
  redirect to the join page _before_ `ensureUserTenantContext` runs its
  create branch), and `acceptInvitation` creates the membership.
- By the time `app/page.tsx` calls `ensureUserTenantContext`, the membership
  exists, so the create branch is not taken.
- An invite-only user who abandons the join page and navigates to `/` directly
  still has zero memberships and _would_ get a personal tenant bootstrapped —
  acceptable and self-consistent (they simply get their own first booth, and can
  still redeem the link later to also join the inviter's tenant). Noted as an
  edge, not a blocker (§9, §13).

### 5.7 Creating an additional tenant

"Crear nueva cuenta" in the switcher runs `createTenant(name)`:

- Insert a `tenants` row (`name`, `created_by_user_id = auth.uid()`) and a
  `tenant_users` membership for the creator (display name via `getDisplayName`),
  atomically (one transaction), then **switch active** to it (§5.4).
- This is the explicit sibling of the implicit first-sign-in bootstrap; both set
  `created_by_user_id`.
- A default name (e.g. "Cuenta de {displayName}" or a user-supplied booth name)
  is fine; naming UX is minor.

## 6. Data, Schema, and Security

### 6.1 Drizzle schema (`lib/db/schema.ts`)

- Add `tenants.createdByUserId uuid` (nullable).
- Add the `tenant_invitations` table per §4.2: columns, `unique(token)`, index on
  `tenant_id`, FK `tenant_id → tenants(id) ON DELETE cascade`, and its
  `tenantsRelations` / `tenantInvitationsRelations` entries.
- Generate with `npm run db:generate` — **do not hand-edit** the generated files.
- **No `lib/db/client-schema.ts` change** — `tenant_invitations` does not sync,
  and `tenant_users` already exists client-side.

### 6.2 Hand-written SQL (`supabase/manual/`, `auth.users` FKs + RLS)

A timestamped file under `supabase/manual/`, run in the SQL editor after
`npm run db:push` (per the project rules for `auth.users` FKs and RLS):

- `tenants.created_by_user_id` → `auth.users(id) ON DELETE SET NULL`.
- `tenant_invitations.created_by_user_id` → `auth.users(id) ON DELETE SET NULL`
  (keep the audit row even if the creator's auth user is deleted; `tenant_id`
  cascade already removes invitations when the tenant goes).
- `ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY`, with policies as
  **defense-in-depth** (the app reads/writes this table only over the trusted
  server connection, so it does not depend on these — but a future PostgREST
  exposure should stay safe):
  - SELECT `USING current_user_has_tenant(tenant_id)`.
  - INSERT `WITH CHECK current_user_has_tenant(tenant_id) AND created_by_user_id = auth.uid()`.
  - UPDATE (revoke) `USING current_user_has_tenant(tenant_id)`
    `WITH CHECK current_user_has_tenant(tenant_id)`.
  - No DELETE policy (invitations are revoked, not deleted).

> The redeem path reads an invitation **before** the user is a member, so it
> cannot rely on the member-only SELECT policy. That is fine: redemption runs in
> a server action on the trusted Drizzle connection (not the `authenticated`
> role), so RLS does not apply to it — the same way `tenants` and every
> repository read already work. No `SECURITY DEFINER` helper is required.

### 6.3 RLS for `tenant_users` writes (membership insert on redeem)

`acceptInvitation` and `createTenant` insert `tenant_users` rows on the trusted
server connection, so they are not RLS-bound. Today `tenant_users` has only
SELECT policies (read), which is correct — keep it that way. **Do not** add a
client INSERT policy: memberships are only ever created server-side (bootstrap,
accept, create). This preserves the property that a device cannot self-join a
tenant by writing a `tenant_users` row through PostgREST.

### 6.4 PowerSync — no change

- **Sync rules (`powersync/sync-rules.yaml`): unchanged.** `tenant_invitations`
  is not synced; `tenant_users` is already in the `by_tenant` stream and already
  scoped by the active-tenant claim. A switch re-evaluates the stream against the
  new claim automatically on reconnect.
- **Publication: unchanged.** Do **not** add `tenant_invitations` to the
  `powersync` publication. (Call-out because the inventory PRD §6.3 trained us to
  add new tables to the publication — this one is the deliberate exception.)
- The only PowerSync-adjacent behavior is the **clear + reconnect on switch**
  (§5.4), which uses existing controls and needs no infra change.

### 6.5 Deploy ordering

Lighter than the inventory feature because there is no new synced table:

1. `npm run db:push` — Drizzle migration (the `tenants` column +
   `tenant_invitations` table).
2. Run the manual SQL from §6.2 in the Supabase SQL editor (FKs + RLS), against
   **every** environment.
3. Ship the app build (server actions, `/join` route, Settings UI). No PowerSync
   Cloud sync-rule deploy, no publication change.

### 6.6 Invitation token at rest (hashed lookup + encrypted delivery)

The bearer secret is protected at rest in two parts:

- **`token` (hash):** HMAC-SHA256 of the raw token using a server-held secret.
  Redeem lookups compare against this hash; a database leak does not expose
  usable join links.
- **`token_delivery_ciphertext` (optional):** AES-256-GCM ciphertext of the raw
  token, encrypted with the same server secret. Enables re-display of the active
  link in Settings without storing the bearer token in plaintext. Nullable for
  legacy rows — those links must be explicitly revoked and regenerated.

**Re-display semantics:** the raw link is returned once at creation and can be
shown again in later sessions only when decryption succeeds. There is no
guarantee of re-display for rows missing delivery ciphertext; members must revoke
and generate a new link in that case. Silent rotation of an active invitation
when the bearer token is unavailable is **not** permitted.

**What contains the blast radius:**

- **High entropy** — 32 random bytes (`crypto.randomBytes(32)`, §7.1); not
  guessable or enumerable.
- **Revocable + expiring** — `revoked_at` and a hard `expires_at` (§4.2, §5.1)
  bound the window a leaked token is usable.
- **Not synced, server-only** — the table is never in the PowerSync
  publication/sync rules and is read/written only over the trusted server
  connection (§4.2, §6.4); it never lands in device SQLite.
- **RLS defense-in-depth** (§6.2) limits any future PostgREST exposure to
  tenant members, who can already mint invitations anyway.
- **HTTPS transport** — links are only meaningful over TLS in production.

## 7. Implementation Details

### 7.1 Token generation

- `crypto.randomBytes(32)` → base64url (Node server action context). High-entropy
  opaque secret; **not** a uuid (uuids are lower-entropy and read as guessable
  IDs). Persist `HMAC-SHA256(rawToken)` in `token` for lookup; persist
  `AES-256-GCM(rawToken)` in `token_delivery_ciphertext` for re-display (§6.6).
- The link is `${origin}/join/${rawToken}` where `origin` is derived from a
  configured `NEXT_PUBLIC_APP_URL` / `APP_URL`, or validated request headers
  (`lib/request-origin.ts`).

### 7.2 Server actions (new, in `app/` — `"use server"`)

- `createInvitation()` → inserts a row for the active tenant, returns the link.
- `revokeInvitation(invitationId)` → sets `revoked_at`.
- `acceptInvitation(token)` → validate, upsert membership, set active claim,
  redirect.
- `switchTenant(tenantId)` → membership check + write claim (client finishes the
  clear/refresh/refresh dance).
- `createTenant(name?)` → insert tenant + membership (one tx, sets
  `created_by_user_id`), then behaves like a switch to it.

All membership/invitation DB work goes through `lib/db` (trusted). All
`app_metadata` writes go through `createAdminClient()` (`lib/supabase/admin.ts`,
`server-only`). Factor the reusable membership/claim helpers out of
`lib/auth/user-context.ts` (`getDisplayName`, an `ensureMembership`, the claim
writer) so the actions and the existing bootstrap share one implementation.

### 7.3 Settings UI (`components/screens/settings-screen.tsx`)

- **Account header** → becomes the **tenant switcher**: list `tenantContext.tenants`,
  mark the active one, each row switches on tap; a "Crear nueva cuenta" row at the
  end.
- **Equipo** section: keep the read-only member list; add the **invite-link
  card** (§5.1) above or below it.
- Reuse the existing sign-out clear-local pattern for the switch handler.

### 7.4 Cleanup

- Remove `assertUserCanJoinTenant` from `scripts/invite-tenant-user.ts` (it
  blocks multi-tenant). The script stays as a QA convenience but is superseded by
  the UI for real use; update its header comment accordingly.

## 8. UI / Screens Touched

- **`app/join/[token]/page.tsx`** (new): validate + join screen, invalid-invite
  state.
- **`app/login/page.tsx`**: read `next`, render it as a hidden field in both
  forms.
- **`app/auth/actions.ts`**: propagate + sanitize `next`; skip bootstrap on the
  invite path.
- **`app/auth/callback/route.ts`**: already handles `next` — no change expected.
- **`components/screens/settings-screen.tsx`**: switcher, create-account,
  invite-link card.
- **`lib/auth/user-context.ts`**: all-memberships load + active resolution;
  extracted shared helpers; `UserTenantContext.tenants`.
- **`app/page.tsx`**: pass the membership list through to the app/Settings.
- **`lib/types.ts`**: a `TenantInvitation` shape (server-side) and a
  `TenantSummary { id, name }` for the switcher list.
- **New server actions** file(s) under `app/` (e.g. `app/tenants/actions.ts`,
  `app/invitations/actions.ts`).

## 9. Edge Cases

- **Already a member redeems again** → idempotent no-op membership; still sets
  the tenant active and drops them in. Safe to re-share a link with existing
  members.
- **Revoked/expired link** → invalid screen; no tenant info leaked; user can ask
  for a fresh link.
- **Switching with unsynced local writes** → `clearLocal` wipes the upload queue.
  The switch must only run when sync is settled; otherwise pending writes for the
  old tenant are lost. Gate the switcher on a settled sync status (reuse the
  diagnostics/sync-status signal) or warn — see Open Items.
- **Stale active claim** (user switched on device A; device B still holds the old
  claim) → `ensureUserTenantContext` re-resolves: if the claimed tenant is still
  a membership it stays; the user re-picks on B if they want the other one. No
  crash, because resolution falls back to a valid membership.
- **Creator's auth user deleted** → `created_by_user_id` / invitation
  `created_by_user_id` go `NULL` (SET NULL); tenant and memberships are
  unaffected; tenant invitations are removed only when the **tenant** is deleted
  (cascade), which is out of scope this release.
- **Invite-only user abandons join, lands on `/`** → bootstraps a personal
  tenant (§5.6). Acceptable; they can still redeem later.
- **Two booths, same product catalog** → tenants are fully isolated; catalogs do
  not share. Re-entering products per booth is expected (cross-tenant catalog
  copy is a future idea, not here).
- **`tenant_id` claim missing right after switch** → the connector already
  refreshes the session when the claim is absent
  (`lib/powersync/connector.ts`); the switch also refreshes explicitly.

## 10. Performance

- Invitation create/redeem/revoke are single-row server writes — negligible.
- The active-tenant resolution adds one small `tenant_users ⋈ tenants` read per
  request that already happened (it replaces the `.limit(1)` read with an
  unbounded-but-tiny membership read; a user has a handful of tenants).
- A **switch pays a full re-sync** of the new tenant's data (the deliberate cost
  of one-tenant-per-device). This is the same cost as a fresh sign-in and is
  acceptable for an intentional, infrequent action.

## 11. Build Sequence

1. **Schema** — `tenants.created_by_user_id` + `tenant_invitations` in
   `lib/db/schema.ts`; `npm run db:generate`. Manual SQL (§6.2). Deploy per §6.5.
2. **Active-tenant foundation** — multi-membership `loadMembership` + resolution,
   `UserTenantContext.tenants`, extracted shared helpers, `created_by_user_id` in
   bootstrap. (Independently shippable; the app still works with one tenant.)
3. **Switch + create** — `switchTenant`, `createTenant` server actions; Settings
   switcher + create-account UI; client clear/refresh orchestration.
4. **Invitations** — token gen, `createInvitation`/`revokeInvitation`/
   `acceptInvitation`; `/join/[token]`; `next` propagation in login + auth
   actions; Settings invite-link card.
5. **Cleanup** — drop `assertUserCanJoinTenant`; update script header.
6. **QA** — §12.

A natural two-PR split: **(1–2)** the multi-tenant foundation, then **(3–5)** the
switch + invitation surface.

## 12. Acceptance Criteria

Validated on real installed PWAs (iPhone Safari + Android Chrome), consistent
with the parent PRD's dual-platform gate.

**Invitation happy path (the decisive test)**

- User A (tenant "Booth 1") generates an invitation link in Settings and copies
  it.
- On a second device, User B opens the link, signs up (or signs in) with **their
  own** credentials, and taps "Unirme".
- B lands in "Booth 1", can register a sale, and the sale shows up on A's device
  attributed to B. B appears in A's team list.
- The **same link** still works for a User C (reusable-until-revoked).

**Revoke / expiry**

- A revokes the link; opening it now shows the invalid-invitation screen and
  does not add a member.
- (If feasible to test) a link past `expires_at` is rejected the same way.

**Multi-tenant, one login**

- User A creates a second tenant "Booth 2" from the switcher.
- A switches between Booth 1 and Booth 2: each shows only its own products and
  sales; switching re-syncs and never shows the other booth's data.
- A sale rung up in Booth 2 never appears in Booth 1 and vice versa.
- A helper invited to Booth 1 only does **not** see Booth 2.

**A helper across two booths**

- A invites User B to both Booth 1 and Booth 2 (two links, or the same flow
  twice).
- B's switcher lists both; B switches and registers sales in each; each sale is
  attributed to B in the correct tenant.

**Switch safety**

- Switching after sync has settled loses no data; the previous tenant's local
  store is cleared and the new tenant fully re-syncs.

**Bootstrap isolation**

- A brand-new user who signs up via an invite link ends up **only** in the
  inviter's tenant — no stray personal tenant is created (§5.6).

**`created_by` recorded**

- The tenant created by the bootstrap and by `createTenant` both carry the
  creator's `user_id` in `tenants.created_by_user_id`.

## 13. Open Items

1. **Invite TTL value.** `DEFAULT_INVITE_TTL` = **7 days** (recommended). Decide
   if festival use wants longer (e.g. 30 days) or a per-link choice. _(Decided:
   reusable-until-revoked **with** a fixed auto-expiry; exact duration is the only
   knob left.)_
2. **Switch-while-dirty guard.** _(Resolved — implemented.)_ The switcher
   enforces a **hard** sync-settled gate: `SettingsScreen`'s `canSwitchTenant`
   (`useSyncStatus`: `state === "synced" && pendingCount === 0`) disables both
   switching and account creation until sync is fully settled with zero pending
   uploads, consistent with §5.4. Not a warn-and-proceed; the action is blocked.
3. **Member removal / leave-tenant.** Out of scope here; likely the very next
   feature. Requires a `tenant_users` DELETE path (server-side) and re-resolving
   the active tenant if a user leaves the active one. _(Deferred.)_
4. **Invite-only user who abandons the join** (§5.6) gets a personal tenant.
   Accept as-is, or suppress bootstrap when a pending-invite cookie is present.
   Recommend accept-as-is for v1. _(Open, low stakes.)_
5. **Tenant naming UX** for `createTenant` (auto-name vs. prompt). Minor.
   _(Open.)_

## 14. Forward Compatibility

- **Roles** slot in cleanly later: add `tenant_users.role` (default a permissive
  member role) and gate `createInvitation`/`revokeInvitation`/member-removal on
  it. `created_by_user_id` is already the natural seed for an "owner" role.
- **Member removal and tenant deletion** build on the same server-action +
  active-tenant-resolution machinery introduced here.
- **Email-delivered invitations** can layer on top: the token/link model is
  unchanged; an email step would just send the same `/join/{token}` link.
- **Named/seat-limited invitations** would add columns to `tenant_invitations`
  (`email`, `max_uses`, a redemptions log) without disturbing the reusable-link
  default.
- **Token at rest** uses hashed lookup plus encrypted delivery ciphertext (§6.6).
  Legacy plaintext-only rows, if any, require explicit revoke + regenerate.

---

_End of document._
