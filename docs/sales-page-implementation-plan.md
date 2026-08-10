# Dedicated Sales Page — Implementation Plan

**Status:** Implemented  
**Date:** 2026-08-09

## Objective

Add a dedicated Sales screen where users can:

- See today's activity by default.
- Select week, month, or an inclusive custom date range.
- Open full sale/refund details.
- Void eligible sales.
- Refund eligible sales.
- See completed, voided, and refunded records without leaving Sales.

## Product rules

- Committed sales are immutable and never deleted.
- "Cancel" means **void**.
- Void allowed only when the original sale is completed, has no refund, and is at most 10 minutes old.
- Refund allowed only when the original sale is completed, unvoided, and not already refunded.
- Refunds are full-sale, append-only records. Partial refunds remain out of scope.
- Voided sales remain visible but excluded from totals.
- Refunds use their own transaction timestamp and appear as negative activity in that period.
- Backend/local mutation checks remain authoritative; UI eligibility is advisory.

## Recommended product decisions

Proceed unless changed before implementation:

1. Add **Ventas** as a fifth primary bottom-navigation item.
2. Remove the duplicated recent-sales list from Reports; retain a compact **Ver ventas** link.
3. Confirm void/refund before execution.
4. Let users optionally record a refund reason.
5. Keep the current single-screen PWA architecture; no `/sales` URL route.

## UX specification

### Screen structure

1. Header: **Ventas**.
2. Date presets: **Hoy**, **Esta semana**, **Este mes**, **Rango**.
3. Custom range: **Desde** and **Hasta** date inputs.
4. Compact range summary: transaction count and net activity.
5. Ledger grouped by Bolivia calendar date.
6. Incremental **Ver más** pagination for large ranges.
7. Dedicated empty state when no activity matches.

### Sale rows

Show:

- Reference.
- Time.
- Seller.
- Payment method.
- Product summary.
- Net amount.
- Derived status: completed, voided, refunded, or refund record.

Tapping a row opens the existing sale detail screen. Eligible original sales expose quick void/refund actions. Voided sales and refund records expose no corrective actions.

### Action flows

**Void**

1. User selects **Anular**.
2. Confirmation explains the sale stays in history and leaves totals.
3. Submit through existing local-first/server fallback handler.
4. Disable repeated submission.
5. Show success/error toast; refresh row/detail through existing store/PowerSync watch.

**Refund**

1. User selects **Reembolsar**.
2. Confirmation explains a full negative transaction will be created.
3. Optional reason input.
4. Submit through existing local-first/server fallback handler.
5. Disable repeated submission.
6. Show success/error toast; show both linked records.

### Sale detail navigation

Track the originating view. Back returns to Sales when opened from Sales and Reports when opened from Reports. Original-sale/refund relationships remain visible.

## Technical plan

### 1. Shared date-range domain logic

Refactor `lib/dates.ts` or add a focused sales-range module:

- Replace device-local boundaries with Bolivia boundaries (`America/La_Paz`, UTC−4).
- Monday-start week.
- Inclusive custom start/end dates.
- Validate start ≤ end; do not silently reverse invalid input.
- Exclude invalid timestamps.
- Accept a supplied `now` for deterministic tests.
- Share the same filter between Sales and Reports.

This fixes existing behavior that depends on the device timezone, contrary to the finance PRD.

### 2. Shared sale-action eligibility

Centralize in `components/screens/sale-detail-screen.helpers.ts` or a domain helper:

- `canVoidSale(sale, sales, now)`.
- `canRefundSale(sale, sales)`.
- Exact millisecond 10-minute cutoff; remove floor-minute behavior.
- Derive display status for original sales with linked refunds.

Sales screen updates `now` periodically so the void action expires while open. Mutation code still rechecks every rule.

### 3. New Sales screen

Create `components/screens/sales-screen.tsx`:

- Reusable date selector.
- Memoized filtered/sorted records.
- Today default on entry.
- Grouped ledger and summary.
- Progressive client rendering.
- Empty, pending, success, and error states.
- Existing `SaleRow` and sale calculation helpers where appropriate.

All data remains local-first. No range-specific network query: server hydration and PowerSync already provide the tenant's sales, lines, and refunds.

### 4. Navigation and shell wiring

- Add `"sales"` to `lib/views.ts`.
- Add **Ventas** to `components/organisms/bottom-nav.tsx`.
- Change nav layout from four to five columns; verify labels and touch targets at 320–480 px widths.
- Import/render Sales in `components/templates/glitter-pos-app.tsx`.
- Include Sales among views that show bottom navigation.
- Track sale-detail return view.
- Pass existing void/refund handlers to Sales.

### 5. Action plumbing

Reuse:

- `app/sales/actions.ts`.
- `lib/sales/repository.ts`.
- `lib/powersync/write-sales.ts`.
- Existing Zustand/PowerSync updates in `glitter-pos-app.tsx`.

Extend refund handler signatures to pass the optional reason end-to-end. Do not add delete actions, delete RPCs, or database mutations.

### 6. Reports cleanup

- Extract the date selector/filter rather than duplicating it.
- Remove the duplicated recent-sales list from Reports; retain a compact **Ver ventas** link.
- Preserve every report metric and inventory section.

### 7. Documentation

Update `docs/glitter-finance-prd.md`:

- Dedicated Sales screen.
- Five-item navigation.
- Reports no longer owns sale management.
- Delete remains prohibited.

## Expected file changes

| File                                               | Change                                    |
| -------------------------------------------------- | ----------------------------------------- |
| `components/screens/sales-screen.tsx`              | New dedicated screen                      |
| `components/molecules/sale-row.tsx`                | Status/action presentation refinements    |
| `components/screens/sale-detail-screen.tsx`        | Confirmation and refund-reason flow       |
| `components/screens/sale-detail-screen.helpers.ts` | Central eligibility/status logic          |
| `components/screens/reports-screen.tsx`            | Shared range UI; remove recent-sales list |
| `components/organisms/bottom-nav.tsx`              | Add Sales item                            |
| `components/templates/glitter-pos-app.tsx`         | Screen, actions, return-view wiring       |
| `lib/views.ts`                                     | Add `sales` view                          |
| `lib/dates.ts` or new range module                 | Bolivia-aware filtering                   |
| `tests/dates.test.ts`                              | Range/timezone tests                      |
| `tests/sale-actions.test.ts`                       | Eligibility/status tests                  |
| `docs/glitter-finance-prd.md`                      | Product documentation update              |

## Database impact

None expected.

Existing schema, server repositories, PowerSync writes, atomic RPCs, tenant authorization, immutability trigger, and refund uniqueness already enforce the required model.

## Test plan

### Automated

- Today boundaries before/after Bolivia midnight.
- Monday week boundary.
- Month/year rollover.
- Inclusive custom start/end.
- Invalid/reversed custom range.
- Refund filtered by refund timestamp.
- Void at exactly 10:00; reject after 10:00.
- Reject void after refund.
- Reject refund after void or prior refund.
- Derived status for linked original/refund records.
- Existing test suite.
- Formatting check and production build.

### Manual

- Sales reachable in one tap.
- Today selected on first entry.
- Five-item nav usable at narrow phone widths.
- Open detail and return to correct screen.
- Void/refund online.
- Void/refund offline; reconnect and confirm sync.
- Two-device duplicate refund converges to one canonical refund.
- Action double taps create one mutation.
- Void action disappears when the 10-minute window expires.
- Installed iOS PWA and Android PWA smoke test.

## Acceptance criteria

- Sales accessible directly from primary navigation.
- Today shown by default.
- Presets and custom inclusive date range work in Bolivia time.
- Completed, voided, original-refunded, and refund records are distinguishable.
- Every valid sale action is available from Sales or its detail screen.
- Invalid actions hidden/disabled and rejected by mutation layer.
- No committed sale can be edited or deleted.
- Remove the duplicated recent-sales list from Reports; retain a compact **Ver ventas** link. Report metrics and inventory sections preserved.
- Online/offline behavior remains local-first and convergent.
- No schema migration required.

## Suggested implementation sequence

1. Date and eligibility helpers with tests.
2. Shared date selector.
3. Sales screen and ledger.
4. Navigation/shell/detail-return wiring.
5. Confirmation/refund-reason plumbing.
6. Reports cleanup.
7. Automated and device verification.
8. PRD update.
