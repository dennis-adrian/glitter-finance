# Billetera Ferial Implementation Notes

## Current Slice

This first implementation is a local-first Stage A slice. It deliberately proves the high-frequency POS interaction before wiring in hosted infrastructure.

Implemented now:

- Mobile-first Next.js app shell.
- Persistent local product catalog, draft cart, and sales history.
- Sell Mode default landing screen.
- Tap product to add, long-press product to decrement.
- Cart review screen.
- Payment screen with sale-level discount presets and custom discount.
- Cash and QR payment methods.
- Immutable sales with snapshotted product price, cost, category, and quantity.
- Void and refund actions in reports.
- Basic reporting over today, week, and month.
- Supabase SSR client scaffolding, auth actions, callback route, and login page.
- Drizzle schema and Drizzle-journaled migrations in `supabase/migrations` for tenants, users, products, sales, sale lines, refunds, Supabase auth foreign keys, and RLS policies.

## Backend Boundary

The local store is intentionally shaped like the eventual sync model:

- Products, sales, sale lines, voids, and refunds use client-generated IDs.
- Committed sales are append-only.
- Sales snapshot price and cost at the time of sale.
- Draft carts are local-only and not represented as committed sales.

Supabase Auth, Drizzle schema, runtime Drizzle client, and RLS policies are scaffolded. Drizzle owns migration generation/tracking; the output folder is `supabase/migrations` to align with Supabase project structure. PowerSync, storage-backed image upload, and replacing the local Zustand store with synced reads/writes are the next infrastructure layer.

Server actions (`app/*/actions.ts`, except the auth form actions, which return their own state) return an `ActionResult` from `lib/action-result.ts`: `{ ok: true, data }`, or `{ ok: false, error }` with a Spanish message for an expected failure (invalid input, a changed active tenant, a sale outside the void window). Code below them signals those failures by throwing a `UserFacingError`, and `toActionResult` turns it into the result; any other error is still thrown, so Next.js masks it and Sentry reports it. A thrown action error would reach the browser as Next.js' generic English message in production, so screens call actions through `unwrapActionResult`, which shows the action's message or a Spanish fallback.

Tenant bootstrap is wired into the root app entry. An authenticated user is resolved through Supabase Auth; if they have no `tenant_users` membership, the server creates a tenant and membership row through Drizzle before rendering the POS. The UI still uses the local Zustand product/sales store until Supabase-backed product and sale repositories are connected.

## Known Follow-ups

Deferred items that are acceptable for the current slice but should be revisited. None block the current Stage A work.

### Product image upload

- **Replaced and orphaned images are deleted, best-effort.** Once Postgres has applied a new `products.image_path`, the image it replaced is deleted: by the `uploadProductImage` server action (service role), and in PowerSync mode by the upload connector (`lib/powersync/connector.ts`) with the user's session. If a newer edit from another device kept another image (last-write-wins), the new upload is deleted instead, and so is an upload whose product write failed. Only `<tenant_id>/products/<product_id>/<uuid>.<jpg|png>` objects of that product are ever deleted, never seed images. A crash between upload and cleanup, or an environment without the delete policy, still leaves unused files. A periodic sweep of objects that no product row references would catch those, but it must skip recent objects: a device can upload an image and go offline before its product write reaches the server.
- **Storage enforces the upload rules.** The `product-images` bucket accepts JPEG and PNG up to 5 MiB: [`supabase/manual/20260926130000_product_images_storage_rules.sql`](../supabase/manual/20260926130000_product_images_storage_rules.sql) sets that on hosted projects, and `supabase/config.toml` on the local stack, matching `lib/product-image-config.ts`. The app checks the same rules first only to show a clearer message. Storage compares the declared content type, not the file bytes, so a client can still store other content under an image type. It is served from the Supabase origin, not the app origin, so it cannot run script in the app.
- **Public bucket is cross-tenant readable.** `product-images` is a public bucket, so any object URL is world-readable and the tenant-scoped path (`<tenantId>/products/<productId>/<uuid>.<ext>`) is guessable. Accepted because product images are not sensitive and the PRD treats them as display assets. Revisit if images ever carry tenant-private information (would require a private bucket plus signed URLs or an RLS-gated read path). See `supabase/migrations/20260607185822_supabase_storage_bucket.sql`.
- **Uploads run with the signed-in user's session.** In PowerSync mode the browser uploads straight to Storage (`uploadProductImageLocal` in `lib/powersync/write-products.ts`). Otherwise the `uploadProductImage` server action checks that the product belongs to the tenant and then uploads with the user's cookie session, not the service role. Either way the Storage INSERT policy allows only `<tenant_id>/products/<product_id>/<uuid>.<jpg|png>` in a tenant the user belongs to (`tenant_users` membership). Every signed-up user gets a tenant, so any account can upload into its own folder; the bucket limits bound each upload. A DELETE policy with the same tenant check lets the app remove images it no longer references. There is no UPDATE policy: every upload gets a fresh name.
