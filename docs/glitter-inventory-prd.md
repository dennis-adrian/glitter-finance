# Glitter Finance — Inventory Tracking PRD

**Author:** Adrian Guzman
**Status:** Draft v1.1
**Date:** June 2026
**Parent:** `docs/glitter-finance-prd.md` (this feature is Future Feature §11.1, promoted to its own spec)

> v1.1 — reviewed against the Stage D multi-user changes (`tenant_users`
> replication, manual publication script, invite flow). Model confirmed
> multi-user-safe (§3.2); added the replication-publication and deploy-ordering
> requirements (§6.3, §6.5) and a two-user acceptance script (§12).
>
> v1.2 — reconciled with the implemented feature. Recorded the three decisions
> that were open during planning and are now settled in code: full reason enum
> (§13.4), nullable per-product `low_stock_threshold` + global default (§13.3),
> and the double-`initial` write-path guard (§5.1).

---

## 1. Overview

Inventory tracking lets a vendor record how many units they have of a product
and see that count decrease as sales are recorded. It is **optional per
product**: a vendor can track stock on some products and leave others as the
countless, always-sellable items they are today. The feature works fully
offline and across multiple devices on the same account, and it never blocks a
sale — when stock runs out, the sale still goes through and the product is shown
as oversold.

This document specifies the data model, sync strategy, RLS, write path,
derivation, UI, and acceptance criteria needed to implement it. It assumes the
architecture already described in the parent PRD: PowerSync between Supabase
Postgres and per-device SQLite, append-only sales/refunds, last-write-wins on
product edits, real tenants with RLS.

## 2. Goals and Non-Goals

**Goals**

- A vendor can opt a product into inventory tracking and set its starting count.
- Recording a sale reduces the tracked product's remaining count automatically.
- Voiding or refunding a sale returns its units to stock.
- A vendor can restock (add units) and adjust (correct, record loss/gift) with a
  reason, at catalog-setup time.
- Sell Mode surfaces low / out / oversold states without ever blocking a sale.
- Everything works offline and stays correct when two people on the same account
  sell the same product offline at the same time.

**Non-Goals (this release)**

- Warehouse / global stock pools (parent §11.2).
- Events with stock loaded in and returned on close (parent §11.3).
- Bundles that decrement multiple component products (parent §11.5).
- Blocking, reserving, or hard-gating a sale on stock. Stock informs; it never
  prevents.
- Stock valuation reporting beyond a simple units-remaining figure (full
  inventory-value P&L is later).

## 3. The Core Decision: Derive Stock from an Append-Only Ledger

The intuitive design — a mutable `stock_count` column on the product,
decremented at sale time — is **incompatible with this app's sync model** and is
explicitly rejected.

Sales and refunds are append-only with client-generated UUIDs, so two devices
never collide: each sale is a brand-new row. But **product edits use
last-write-wins** (parent §9; the upload connector at
`lib/powersync/connector.ts` PATCHes changed columns with no merge). A stock
counter is a mutable field mutated concurrently by multiple offline writers,
which is exactly what last-write-wins destroys:

- Phone A (offline) sells 3 → reads stock 10, writes **7**.
- Phone B (offline) sells 2 → reads stock 10, writes **8**.
- Both reconnect → the later sync wins → stock ends at **7 or 8, never 5**. One
  phone's decrement is silently lost.

This cannot be fixed with a server-side atomic decrement, because PowerSync
uploads a **resolved literal value** through PostgREST (`.update({ stock_count:
7 })`), not a `stock = stock - 3` expression. The wrong number is computed
on-device before it ever reaches Postgres.

**The chosen model: never store the count. Derive it from append-only events.**
This mirrors how the app already treats financial truth (sales are events, not a
mutable balance).

- **Supply** (units added) is an **append-only `inventory_movements` ledger**:
  initial count, restocks, adjustments, losses, gifts. Each is an immutable row,
  so concurrent offline writers never clobber each other — same property that
  makes sales safe.
- **Sold** (units removed) is **derived from the `sale_lines` rows that already
  exist**. Sales do not write inventory movements. This keeps the checkout hot
  path untouched (the sub-300 ms commit budget in parent §7.3 is unaffected) and
  avoids double-counting.

```
stock(product) =   Σ inventory_movements.delta            (for that product)
                 − Σ sale_line.quantity on completed sales (not voided)
                 + Σ sale_line.quantity on refunded sales  (units returned)
```

Negative results are allowed and meaningful (oversold). Nothing in the formula
prevents or clamps them.

### 3.1 Why not also write a movement per sale?

A "single table is the only source" variant would write one movement row per
sale line. Rejected because it (a) adds writes to the latency-critical checkout
path, (b) duplicates data already in `sale_lines`, and (c) requires keeping the
two in lockstep on void/refund. Deriving "sold" from `sale_lines` reuses the
existing append-only data and the existing void/refund reconciliation for free.

### 3.2 Correctness with multiple users on one tenant

The model is correct for a tenant with several users (booth helpers), and for
the same reason it is correct across devices: **PowerSync sync is scoped by
`tenant_id`, not by user.** A few users do not change the math — they are just
more devices in the same tenant stream.

- **Movements never collide.** `inventory_movements` is tenant-scoped,
  append-only, and user-attributed with a client UUID — the same shape as
  `sales`. User B's restock and User A's adjustment are distinct rows that both
  replicate to every device in the tenant; there is nothing to merge.
- **Cross-user sales already reduce stock.** "Sold" is derived from
  `sale_lines`, which already replicates to every member's device (this is how
  the by-user report breakdown works today — see
  `lib/powersync/sales-from-local.ts` and `tenant-users-from-local.ts`). A sale
  rung up by User B is therefore subtracted from the stock User A sees, with no
  extra wiring.
- **Attribution.** `inventory_movements.user_id` is resolved to a display name
  the same way sale sellers are: against the synced `tenant_users` rows via
  `resolveUserDisplayName` / `buildUserNameMap`
  (`lib/powersync/tenant-users-from-local.ts`). Not surfaced in the MVP (movement
  history is out of scope), but recorded so any future "restocked by" view is
  consistent with the rest of the app.

The two-device convergence test in §12 is, by construction, a two-**user** test:
different `user_id`s, one `tenant_id`, one tenant stream.

> What multi-user *does* change is operational, not architectural. Stage D
> proved that a synced table only reaches other users' devices if it is in the
> Postgres logical-replication publication — and that publication changes
> **cannot be migrations**. §6.3 and §11 carry that requirement for
> `inventory_movements`; skipping it silently breaks multi-user stock (movements
> never replicate, so each device sees only its own — exactly the bug the
> ledger is meant to prevent).

## 4. Domain Model Additions

**`inventory_movements`** — a new append-only, synced table. One row per supply
event for a tracked product.

| Field              | Type                         | Notes                                                                 |
| ------------------ | ---------------------------- | --------------------------------------------------------------------- |
| `id`               | uuid (text in SQLite)        | Client-generated PK.                                                  |
| `tenant_id`        | uuid                         | Tenant scope. Composite FK target with `product_id`.                  |
| `product_id`       | uuid                         | Composite FK `(product_id, tenant_id) → products(id, tenant_id)`.     |
| `user_id`          | uuid                         | Who recorded it. FK to `auth.users` (hand-written), self-attributed.  |
| `delta`            | integer (signed, non-zero)   | Units added (+) or removed (−).                                       |
| `reason`           | enum `inventory_movement_reason` | `initial` \| `restock` \| `adjustment` \| `loss` \| `gift`.       |
| `note`             | text, nullable               | Optional free text (e.g. "caja dañada en transporte").                |
| `created_at`       | timestamptz / text           | Server/display time.                                                  |
| `client_created_at`| timestamptz / text           | Device clock at creation, for parity with sales/refunds.              |

Sign discipline (enforced by a CHECK, see §6.2):

- `initial`, `restock` → `delta > 0`.
- `loss`, `gift` → `delta < 0`.
- `adjustment` → any non-zero (a manual correction in either direction).

**`products.tracks_inventory`** — a new `boolean NOT NULL DEFAULT false` column.

- `false` → product behaves exactly as today: no count, no badge, always
  sellable.
- `true` → stock is derived and surfaced. Toggling it off later hides the badge
  but retains all movement rows (append-only); toggling back on resumes
  derivation from the existing ledger.

Optional, recommended: **`products.low_stock_threshold`** `integer NULL`. When
null, a global default constant is used for the "low" badge. Lets a vendor set,
say, 3 for one product and 20 for another. Can be deferred to a follow-up; the
MVP can ship with a single global constant.

## 5. Functional Requirements

### 5.1 Opting a product into tracking

In the Product Editor (`components/screens/product-editor.tsx`), a
`tracks_inventory` toggle. When turned on, an **initial stock** numeric field
appears. Saving with an initial count writes exactly one `inventory_movements`
row with `reason = 'initial'` and `delta = <count>`. Setting initial stock is a
calm catalog-setup action (like images per parent §7.1), not a mid-sale action.

The `initial` movement is written **once per product**. Subsequent changes to
on-hand stock are made through restock / adjustment (below), never by re-editing
an "initial" value. This preserves the append-only ledger.

**Double-`initial` rule (decided).** The `initial` movement is written only when
the product has no existing `initial` movement. This is guarded at two layers:
the editor hides the initial-stock field once an `initial` movement exists
(`showInitialStockField` / `hasInitialMovement`), and the save path re-checks
with `productHasInitialMovement` before writing (`needsInitialMovement` in
`glitter-pos-app.tsx`), so the UI guard cannot be bypassed. No database
uniqueness constraint is added: two members enabling tracking offline on the
same product could each write an `initial`, which is an accepted, rare, and
self-correcting race — reconcile with a normal `adjustment`, exactly as
overselling is handled. A partial unique index was rejected because the second
offline write would fail at upload and leave a phantom local row (the same
issue documented for refunds in `lib/powersync/write-sales.ts`).

### 5.2 Restock and adjustment

From the Product Editor (or a product's detail), quick actions:

- **Restock (+N):** writes a `restock` movement with positive delta. The common
  "I brought more units" action.
- **Adjustment (±N):** writes an `adjustment` movement, with an optional note.
  For corrections in either direction.
- **Loss / Gift (−N):** writes a `loss` or `gift` movement with negative delta
  and an optional note. Convenience reasons that map to the journaled-reason
  model the future warehouse feature (parent §11.2) will build on.

Each is a single append-only insert; none mutate an existing row.

### 5.3 Selling a tracked product

No change to the checkout path. Sales write `sales` + `sale_lines` exactly as
today. Stock is recomputed from the new `sale_lines` rows by the derivation in
§3. The vendor sees the product's remaining count drop after the sale commits,
driven by the same watch-subscription re-render that already updates the rest of
the UI.

A sale is **never blocked** by stock. Selling a product at or below zero stock
records the sale normally and the product enters an **oversold** visual state
(parent §11.1). There is no "sell anyway?" confirmation in the MVP — the booth
buyer always wins; the count is informational. (A confirmation prompt is a
possible later refinement; see Open Items.)

### 5.4 Void and refund reconciliation

No special inventory code is needed.

- **Void:** a voided sale is excluded from the "sold" sum (its lines no longer
  count as out), so its units return to stock automatically.
- **Refund:** the refund event adds its line quantities back via the `+ Σ
  refunded` term, so a full refund returns the sale's units to stock
  automatically.

Both fall out of the existing `Sale.status` / `refundOfSaleId` model (see
`lib/powersync/sales-from-local.ts`), reusing the same sign logic as
`computeMetrics`.

### 5.5 Sell Mode display

The product tile (`components/molecules/product-tile.tsx`) shows stock state for
tracked products only:

- **Normal:** remaining count (small, secondary). Untracked products show
  nothing — unchanged from today.
- **Low:** count at or below the threshold → a subdued warning treatment.
- **Out:** count is exactly 0 → an "agotado" treatment, **still tappable**.
- **Oversold:** count below 0 → a distinct treatment showing the negative figure
  (e.g. "−2"), **still tappable**.

The cart quantity tag and tile stock figure are independent: the stock figure
reflects committed sales, not the in-progress cart. (Whether to also subtract
the in-progress cart from the displayed remaining count is an Open Item; the
simplest correct MVP shows committed-only stock.)

### 5.6 Reports

Add to the date-range report (parent §7.6), without disturbing existing figures:

- **Units remaining** per tracked product (current derived stock; a point-in-time
  figure, not range-bound).
- **Oversold flag** on any tracked product currently below zero.

Stock valuation (units × cost) and movement history reporting are out of scope
for this release.

## 6. Data, Schema, and Security

### 6.1 Drizzle schema (`lib/db/schema.ts`)

Add the enum, the table, and the product column. Generate the migration with
`npm run db:generate` (Drizzle owns migrations — never hand-edit the files).

- `inventory_movements`: single-column `id` PK (PowerSync requires it); columns
  per §4; composite FK `(product_id, tenant_id) → products(id, tenant_id)
  ON DELETE RESTRICT` mirroring `sale_lines`; indexes on `(tenant_id,
  product_id)` (the per-product SUM) and `(tenant_id, created_at)`.
- `pgEnum('inventory_movement_reason', ['initial','restock','adjustment','loss','gift'])`.
- `products.tracksInventory boolean NOT NULL DEFAULT false`; optional
  `products.lowStockThreshold integer`.

Mirror all of this in the SQLite client schema
(`lib/db/client-schema.ts`): `inventory_movements` as a `sqliteTable` with text
`id`/uuids/timestamps and integer `delta`; add `tracksInventory` (integer 0/1)
and optional `lowStockThreshold` to the `products` client table. Register
`inventoryMovements` in the exported `clientSchema`.

### 6.2 Hand-written SQL migration (RLS and auth FK)

A separate hand-written `.sql` file under `supabase/manual/` with a timestamp
prefix (e.g. `20260626170000_inventory_movements_rls.sql`), run after the
Drizzle migrations that create `inventory_movements`.

- Add the `auth.users` FK on `user_id` (Drizzle can't model `auth.users`):
  `inventory_movements_user_id_auth_users_id_fk ... ON DELETE restrict`.
- `ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY`.
- **Append-only policies** (mirror `refunds`): SELECT and INSERT only; **no
  UPDATE or DELETE policy** (their absence denies those ops under RLS).
  - SELECT `USING current_user_has_tenant(tenant_id)`.
  - INSERT `WITH CHECK current_user_has_tenant(tenant_id) AND user_id = auth.uid()`.

Domain checks (`delta <> 0`, sign discipline for `reason`) and indexes on
`(tenant_id, product_id)` / `(tenant_id, created_at)` live in
`lib/db/schema.ts` and are applied via Drizzle-generated migrations — not in
this hand-written file.

### 6.3 Replication publication (NOT a migration)

This is the step the Stage D multi-user work proved is mandatory and easy to
miss. A synced table only reaches devices if it is in the Postgres logical
replication publication `powersync`. **Publication changes cannot run as
Drizzle/Supabase migrations** (`ALTER PUBLICATION` is not safely
migration-replayable) — they live under `supabase/manual/` and are run by hand
per environment, exactly like `tenant_users` was in
`supabase/manual/20260626010600_powersync_add_tenant_users_to_publication.sql`.

Add an idempotent script
`supabase/manual/20260626170100_powersync_add_inventory_movements_to_publication.sql`
mirroring the tenant_users one: skip if the `powersync` publication is missing,
skip if `inventory_movements` is already published, else `ALTER PUBLICATION
powersync ADD TABLE inventory_movements`. Run it in the Supabase SQL editor
after `npm run db:push`, against **every** environment (staging and prod).

Also update the README PowerSync setup section, which currently hardcodes the
five-table list in two places (the `CREATE PUBLICATION powersync FOR TABLE ...`
snippet and the post-`supabase db reset --linked` recovery snippet) plus the
deploy-verification checklist. Both `CREATE PUBLICATION` snippets must gain
`inventory_movements`, since a fresh bootstrap and a reset both recreate the
publication from that list.

**Replication grant.** Replication reads run as `powersync_role`
(`REPLICATION BYPASSRLS`). The schema's `ALTER DEFAULT PRIVILEGES IN SCHEMA
public GRANT SELECT ... TO powersync_role` covers tables created by the admin
role that ran it (Drizzle migrations do), so a normal `db:push` of
`inventory_movements` should inherit SELECT — but verify with
`SELECT has_table_privilege('powersync_role','inventory_movements','SELECT')`
and `GRANT SELECT ON inventory_movements TO powersync_role` if it returns false.

Verify the table is published:

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'powersync' AND tablename = 'inventory_movements';
```

### 6.4 Sync rules (`powersync/sync-rules.yaml`)

Add one query to the `by_tenant` stream, mirroring the existing tables (same
`auth.parameters()` form, no `::uuid` cast):

```yaml
      - SELECT * FROM inventory_movements
        WHERE tenant_id = auth.parameters() -> 'app_metadata' ->> 'tenant_id'
```

Deploy by pasting into the PowerSync Cloud Sync Streams editor → Validate →
Deploy.

### 6.5 Deploy ordering (all-or-nothing, per environment)

Stage D showed a partial deploy fails *subtly*, not loudly. For inventory the
failure modes are: schema-without-publication → movements never replicate, so
other users' devices undercount stock; publication-without-sync-rules → rows
replicate to PowerSync but never reach the client; sync-rules-without-client-schema
→ the client can't read the table. Deploy all four together, in order, per
environment:

1. `npm run db:push` (schema + the hand-written RLS/FK/CHECK migration).
2. Run the manual publication script (§6.3); confirm with the query above.
3. Deploy sync rules in PowerSync Cloud (§6.4).
4. Ship the app build (client schema + `inventory_movements` watch).

## 7. Write Path and Derivation

### 7.1 Write helper

New `lib/powersync/write-inventory.ts`, following the established local-write
pattern (`lib/powersync/write-sales.ts`): a single `addInventoryMovement(db,
{ tenantId, userId, productId, delta, reason, note })` that inserts one row in a
`writeTransaction`. PowerSync's CRUD queue uploads it via the connector's plain
INSERT path. No upload-connector changes are needed — append-only INSERT is
already handled.

The Product Editor's initial-stock save and the restock/adjust actions call this
helper.

### 7.2 Derivation

A pure selector, e.g. `computeStockByProduct(movements, sales)` in
`lib/inventory.ts`, returning `Map<productId, number>`:

- Sum `movements.delta` per `product_id`.
- Subtract sold units using the **same sign convention as `computeMetrics` /
  `computeProductTotals`**: iterate sales with `status !== 'voided'`, sign =
  `refundOfSaleId ? -1 : +1`, and accumulate `line.quantity * sign` per product.
  The original sale (sign +1) removes units; the refund clone (sign −1) adds them
  back; voided sales are excluded entirely.

This runs in the existing watch-driven recompute in
`components/templates/glitter-pos-app.tsx` — add an `inventory_movements` watch
(`SELECT * FROM inventory_movements WHERE tenant_id = ?`) next to the existing
products / sales / `tenant_users` watches, and feed its rows plus the sales
already built by `buildSalesFromLocal` into `computeStockByProduct`. Memoized on
the synced row sets.
It is **off the tap critical path** — the sale write does no inventory work, so
checkout latency is unchanged. At festival scale (hundreds of `sale_lines` and a
handful of movements per product) the SUM is trivial in SQLite / memory.

Expose a small derived shape per product for the UI: `{ remaining, state:
'normal' | 'low' | 'out' | 'oversold' }`, where `state` is computed from
`remaining` and the threshold (per-product `low_stock_threshold` or the global
default constant).

## 8. UI / Screens Touched

- **Product Editor** (`components/screens/product-editor.tsx`,
  `product-editor.helpers.ts`): `tracks_inventory` toggle, initial-stock field
  (first enable only), restock / adjustment / loss / gift actions with optional
  note.
- **Product Tile** (`components/molecules/product-tile.tsx`): stock figure and
  low/out/oversold treatment for tracked products; nothing for untracked.
- **Products list** (`components/screens/products-screen.tsx`): optional
  remaining-count column/badge.
- **Reports** (`components/screens/reports-screen.tsx`): units-remaining and
  oversold section.
- **Types** (`lib/types.ts`): add `tracksInventory` (and optional
  `lowStockThreshold`) to `Product`; add an `InventoryMovement` type and a
  `ProductStock` derived shape.
- **Product mapper** (`lib/product-mapper.ts`,
  `lib/powersync/write-products.ts`): carry the new product fields through the
  Postgres↔SQLite↔UI mappings.

## 9. Edge Cases

- **Untracked products:** never show stock, never blocked — current behavior,
  fully preserved. Mixed catalogs (some tracked, some not) must work.
- **Toggling tracking off:** retains movement rows; hides the badge. Toggling
  back on resumes derivation. No data loss.
- **Archived products:** archiving is independent of stock; archived products are
  not sold so their derived stock is inert. Movements are retained.
- **Oversold across devices:** if two offline phones each oversell, the ledger +
  derived-sold sum reconciles to the true (possibly more-negative) figure on
  reconnect — no decrement is lost. This is the property the counter approach
  fails.
- **`tracks_inventory` is itself LWW** (it's a product column). Acceptable: it's
  a rare setup-time toggle, not a per-sale mutation. The *counts* are never LWW
  because they live in the append-only ledger.
- **Clock skew:** movements carry `client_created_at`; ordering of supply events
  does not affect the SUM (addition is commutative), so skew cannot corrupt the
  derived total.

## 10. Performance

- Checkout: **unchanged**. The sale write touches no inventory table; the
  sub-300 ms commit budget (parent §7.3) is not on the line.
- Stock derivation: a memoized SUM recomputed on watch fire, same shape as the
  existing report aggregations. No new network reads (PowerSync local SQLite).

## 11. Build Sequence

1. **Schema** — add the enum, `inventory_movements`, and `products`
   columns to `lib/db/schema.ts` and `lib/db/client-schema.ts`; run
   `npm run db:generate`.
2. **RLS migration** — hand-written RLS/FK/CHECK migration (§6.2).
3. **Replication + sync** — manual publication script + README updates (§6.3),
   then the sync-rules query (§6.4) deployed to PowerSync Cloud. Follow the
   all-or-nothing deploy order in §6.5; this is the step the Stage D multi-user
   work proved is the easy one to forget.
4. **Write helper** — `lib/powersync/write-inventory.ts` (`addInventoryMovement`).
5. **Derivation** — `lib/inventory.ts` (`computeStockByProduct`, `ProductStock`),
   wired into the watch recompute; extend `Product` types and mappers.
6. **Editor UI** — `tracks_inventory` toggle, initial stock, restock/adjust.
7. **Sell Mode UI** — tile stock figure + low/out/oversold states.
8. **Reports** — units-remaining + oversold section.
9. **QA** — the acceptance script in §12.

## 12. Acceptance Criteria

Validated on real installed PWAs (iPhone Safari + Android Chrome), consistent
with the parent PRD's dual-platform gate.

**Single-device basics**
- Enable tracking on a product, set initial 10. Tile shows 10.
- Sell 3 → tile shows 7. Sell 7 more → tile shows 0 ("agotado"), still sellable.
- Sell 1 more → tile shows −1 (oversold), still sellable.
- Restock +5 → tile shows 4.
- Void a recent sale of 2 → remaining increases by 2.
- Refund a prior sale of 3 → remaining increases by 3.

**Offline multi-user (the decisive test)**

Run with **two different users** on one tenant (a primary and an invited member,
provisioned via `npm run db:invite:tenant-user` per the Stage D setup), one on
each device — not one user on two devices.

1. User A (device A) and User B (device B) signed into the same tenant, product
   at stock 10, both synced.
2. Enable airplane mode on **both**.
3. User A sells 3; User B sells 2.
4. Each device locally shows its own decrement (A: 7, B: 8).
5. Reconnect both and let sync settle.
6. **Both devices converge to 5.** No decrement is lost. (This is the result the
   rejected counter model cannot produce.)

**Cross-user supply visibility**
- User A restocks +5 while User B sells 1, both online.
- After sync, both devices agree on the same remaining count, with each other's
  movement and sale reflected. (Confirms supply edits, not just sales,
  replicate across members — mirrors the Stage D cross-device sales script.)

**Replication wiring (catches the publication gap)**
- After deploy, confirm `inventory_movements` is in the `powersync` publication
  (§6.3 query) and that a movement created on one user's device appears on
  another member's device. An empty `inventory_movements` on a second device
  while sales replicate normally points at a missing publication entry or
  sync-rule, not an app bug — the same diagnosis path as Stage D's `tenant_users`.

**Mixed catalog**
- An untracked product shows no stock UI and is always sellable, alongside
  tracked products, with no interference.

## 13. Open Items

1. **In-progress cart vs. displayed stock.** Show committed-only remaining
   (simplest), or also subtract the current cart from the tile figure. MVP:
   committed-only. _(Still open — deferred.)_
2. **Oversold confirmation.** Parent §11.1 mentions a "sell anyway?" prompt. MVP
   omits it (never block, never prompt). Decide if a non-blocking prompt is worth
   adding. _(Still open — deferred.)_
3. **Low-stock threshold.** _(Decided.)_ Both: a nullable per-product
   `low_stock_threshold` column ships now, and the MVP UI falls back to the
   global `DEFAULT_LOW_STOCK_THRESHOLD` (`5`) when it is null
   (`lib/inventory.ts`). The column is final; per-product threshold UI is a pure
   follow-up needing no further migration.
4. **Loss/gift reasons in MVP.** _(Decided.)_ The full reason set ships now —
   the `inventory_movement_reason` enum carries all five values
   (`initial`, `restock`, `adjustment`, `loss`, `gift`) and the editor surfaces
   restock, adjustment, loss, and gift. Including every value up front avoids the
   awkward/irreversible enum-alter path later.

## 14. Forward Compatibility

The ledger is deliberately the shape the future warehouse (parent §11.2) and
events (parent §11.3) features need: tenant-level stock changes with journaled
reasons, append-only. When events arrive, loading stock into an event and
returning leftovers on close become additional movement reasons (or an
event-scoped movement column) rather than a new model. Bundles (parent §11.5)
decrement multiple products by writing multiple movements per sold bundle.
Nothing here precludes those; it is their foundation.

---

_End of document._
