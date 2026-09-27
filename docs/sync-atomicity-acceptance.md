# Sync Atomicity Acceptance

Run on staging after applying
`supabase/manual/20260808235900_powersync_atomic_financial_mutations.sql` and
`supabase/manual/20260926120000_powersync_upload_convergence.sql`, and before
deploying the same set to production.

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

## Discarding a failed operation

1. Inject the permanent error again, record a sale, then record a second sale
   while the first one is failing.
2. In Diagnostics, confirm the failed sale is listed with its error, press
   **Descartar operación** and confirm.

Expected:

- The first sale disappears from the device's sales and reports; nothing of it
  exists in Postgres.
- The second sale uploads once the injected error no longer applies to it (or
  shows up as the next failed operation if it does).
- Diagnostics lists the first sale under **Operaciones descartadas**, and
  **Copiar diagnóstico** includes its full payload.
- Sentry receives a `PowerSync upload discarded on the device` warning with the
  error code and tables only.
- Repeat with a void: after discarding it, the sale shows as not voided on the
  device, matching Postgres.

## Server invariants

The void window is 10 minutes of device time between the sale's `created_at`
and `voided_at`, with 5 seconds of allowance for a voiding device whose clock
is behind the recording device. `lib/sales.ts` (`VOID_WINDOW_MS`,
`VOID_CLOCK_SKEW_TOLERANCE_MS`) and the SQL must agree.

- A void whose `voided_at` is more than 10 minutes after the sale's
  `created_at`, or more than 5 seconds before it, is rejected (`23514`).
- A void made inside the window but uploaded days later is accepted.
- Two concurrent refunds for one sale converge to one canonical refund.
- A sale line for another tenant/product is rejected with no partial sale.
- `anon` cannot execute any `powersync_*` function; `authenticated` can.
- Money and quantity fields that are null, fractional or outside int4 fail with
  `22023`, and nothing is inserted.

## Cross-device conflicts

Use two devices signed in to the same tenant, both offline.

1. Record a sale on device A and let it sync, then take both devices offline.
2. Void the sale on device A and refund it on device B.
3. Bring device B online first, then device A.

Expected:

- The refund is committed; `powersync_void_sale` returns `NULL` for device A's
  void and the sale stays unvoided in Postgres.
- Device A's queue drains with no **Error de sincronización**, and the sale
  shows as refunded (not voided) on device A after the next sync.

Repeat with device A online first: the void is committed,
`powersync_create_refund` returns `NULL` for device B's refund, and device B
drops its local refund without a sync failure.

In Postgres, a server-side refund of a voided sale and a void of a refunded
sale are both rejected (`23514`) by triggers, whichever path writes them.

## Device clock ahead

Set a device clock 10 minutes ahead and record a sale while online.

Expected:

- The upload fails with `55000` and is retried; no failure marker appears.
- Once the server clock is within 5 minutes of the sale's `created_at`, the
  retry succeeds without user action.
- Products and inventory movements created on that device behave the same way.

## Failure classification

- When the device's session ends while uploads are pending (for example, its
  refresh token is revoked by a global sign-out elsewhere), the resulting
  permission errors do not create a failure marker; the uploads resume after
  signing in again.
- Calling an RPC that is not installed (for example, before applying the SQL on
  a fresh project) creates a failure marker whose message names the missing
  function and asks for the pending SQL.
- A product edit rejected by RLS (the user was removed from the tenant) creates
  a failure marker instead of disappearing silently.
