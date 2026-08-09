# Sync Atomicity Acceptance

Run on staging after applying
`supabase/manual/20260808235900_powersync_atomic_financial_mutations.sql` and
before deploying the same pair to production.

## Baseline

1. Install/open the staging PWA and wait for zero pending operations.
2. Create a multi-line sale, void an eligible sale, and refund another sale.
3. Confirm each operation reaches Supabase and the queue returns to zero.
4. Confirm direct authenticated `INSERT` on `sales`, `sale_lines`, and `refunds`,
   and direct authenticated `UPDATE` on `sales`, are denied.

## Atomic rollback

Call `powersync_create_sale` as an authenticated staging user with a valid sale
header and two lines, but make the second line invalid (for example,
`line_total_cents` does not equal price × quantity − discount).

Expected:

- The RPC fails.
- Neither the sale header nor either line exists in Postgres.
- Retrying with valid data inserts the header and every line together.
- Retrying the identical valid payload succeeds without duplicates.

## Device failure retention

1. Temporarily make one staging financial upload fail with a permanent database
   error, then record a sale on the device.
2. Confirm the sync pill shows **Error de sincronización**.
3. Confirm Diagnostics shows one failed operation and its error/payload.
4. Confirm tenant switching and sign-out are blocked.
5. Remove the injected database error and press **Forzar sincronización**.

Expected:

- The original CRUD transaction stayed pending; later transactions did not pass
  it.
- The retry commits exactly once.
- Pending and failed counts return to zero automatically.

## Server invariants

- A void older than 10 minutes is rejected by Postgres.
- A refunded sale cannot be voided.
- A voided sale cannot be refunded.
- Two concurrent refunds for one sale converge to one canonical refund.
- A sale line for another tenant/product is rejected with no partial sale.
