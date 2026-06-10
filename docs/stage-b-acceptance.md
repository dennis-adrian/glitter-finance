# Stage B Acceptance: Offline And Sync Hardening

Stage B is accepted only after these scripts pass on staging with the QA account
and on real installed PWAs for both iPhone Safari and Android Chrome.

## Setup

- Deploy latest app build to staging.
- Confirm Supabase migrations are applied.
- Confirm PowerSync role, publication, and sync rules are active.
- Confirm `NEXT_PUBLIC_POWERSYNC_URL` points at the staging PowerSync instance.
- Seed the QA account with `npm run db:seed:qa`.
- Install the PWA on one iPhone using Safari and one Android phone using Chrome.

## Automated Checks

Run locally before manual QA:

```bash
npm exec -- tsc --noEmit
npm run build
```

Expected:

- TypeScript passes.
- Production build passes.
- `/manifest.webmanifest` includes app icons.
- `/serwist/sw.js` is served by the app.

## Offline Sale Sync

1. Open the staging PWA online and sign in as the QA account.
2. Wait until the sync pill shows a synced state and diagnostics show zero pending operations.
3. Enable airplane mode.
4. Create a cash sale.
5. Confirm the sale appears immediately in recent sales.
6. Confirm the sync pill or diagnostics show offline with pending operations.
7. Create a QR sale with a sale-level discount.
8. Void a recent eligible sale.
9. Refund a prior sale.
10. Disable airplane mode and wait for sync.
11. Confirm diagnostics reach zero pending operations.
12. Confirm the new sale, discounted QR sale, void, and refund rows exist in Supabase.

Expected:

- All offline actions update the UI immediately.
- Pending operation count increases while offline.
- Reconnect clears the pending queue without duplicate rows.
- Reports reflect the local actions before reconnect and remain correct after sync.

## Second Device Sync

1. Keep device A online after the offline sync script has cleared.
2. Open the same tenant on device B.
3. Wait for device B to show synced.
4. Check recent sales and reports.

Expected:

- Device B receives the sales, voids, and refunds created on device A.
- Pending count remains zero on both devices.

## Draft Cart Durability

1. Add several products to the cart.
2. Background the installed PWA, then reopen it.
3. Confirm the cart is still present.
4. Force close and relaunch the installed PWA after a prior successful sync.
5. Confirm the cart is still present.
6. Manually set the singleton `draft_cart.updated_at` older than 24 hours in the local SQLite store.
7. Relaunch the app.

Expected:

- Draft cart survives backgrounding and force close.
- Draft cart is discarded when older than 24 hours.
- Checkout and clear-cart remove the local draft.

## Offline PWA Relaunch

1. Launch the installed PWA online and wait for synced state.
2. Close the PWA.
3. Enable airplane mode.
4. Relaunch the installed PWA.

Expected:

- The app shell loads offline.
- Sell Mode renders from cached shell and local PowerSync data.
- First-ever offline login is not required and remains out of scope.

## Diagnostics

During the scripts above, verify the tester diagnostics screen shows:

- Online/offline state changes.
- Pending queue count increasing and clearing.
- Upload/download errors if network is interrupted mid-sync.
- Last sync timestamp after reconnect.
- Force sync action available for tester use.

## Acceptance Gate

Stage B is accepted only when the full script passes on:

- iPhone Safari installed PWA.
- Android Chrome installed PWA.

Record device model, OS/browser version, tester, date, and any deviations in the
QA notes for the release.
