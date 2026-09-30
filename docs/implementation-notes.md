# Billetera Ferial Implementation Notes

## Current State

The app covers the code for the PRD's build stages A to D (see the README) on its production architecture: Supabase Auth and Postgres, Drizzle for the schema and the server repositories, and PowerSync for the per-device SQLite store the screens read and write.

Implemented now:

- Mobile-first Next.js app shell, installable as a PWA, with an offline app shell through Serwist.
- Sell Mode default landing screen: tap a product to add it, long-press to take one off.
- Cart review screen with quantity controls and per-line discounts (an amount or a percentage, with an optional reason), and a draft cart that survives a reload.
- Payment screen with a sale-level discount (presets, or a custom amount or percentage), cash and QR.
- Immutable sales with snapshotted product price, cost, category, and quantity.
- A sales list with each sale's detail, voids within the void window, and refunds.
- Reports over today, week, month, or a custom range: by category, payment method, product, and seller.
- Optional stock tracking per product.
- Categories each tenant manages (create, rename, delete when unused); every product is filed under one.
- Several tenants per user, a tenant switcher, and invitation links.
- Email and password or Google sign-in, and password reset.
- A sync status pill and a tester Diagnostics screen.

## Backend Boundary

The data model is the sync model:

- Categories, products, sales, sale lines, refunds, and inventory movements take client-generated IDs, so a device can create them offline.
- Committed sales are append-only.
- Sales snapshot price and cost at the time of sale.
- Draft carts are local-only and not represented as committed sales.

Drizzle owns the schema and migration generation/tracking; the output folder is `supabase/migrations` to align with Supabase project structure, and what Drizzle cannot model lives in `supabase/manual/` (see the README). With PowerSync configured, screens read and write the device's SQLite store and PowerSync uploads the writes (`lib/powersync/`). Without it (local-only mode), the same screens call server actions backed by the Drizzle repositories (`lib/*/repository.ts`).

Server actions (`app/*/actions.ts`, except the auth form actions, which return their own state) return an `ActionResult` from `lib/action-result.ts`: `{ ok: true, data }`, or `{ ok: false, error }` with a Spanish message for an expected failure (invalid input, a changed active tenant, a sale outside the void window). Code below them signals those failures by throwing a `UserFacingError`, and `toActionResult` turns it into the result; any other error is still thrown, so Next.js masks it and Sentry reports it. A thrown action error would reach the browser as Next.js' generic English message in production, so screens call actions through `unwrapActionResult`, which shows the action's message or a Spanish fallback.

Every writer checks input with the same shared rules before anything is written, so a value Postgres would reject never enters the PowerSync upload queue, where a data error blocks every later upload from the device. Amounts are parsed by `lib/money.ts` (es-BO grouping, `MAX_PRICE_CENTS`), stock amounts are bounded by `MAX_QUANTITY` and the movement sign rules in `lib/inventory.ts`, products go through `normalizeProductInput` (`lib/products.ts`), ids and notes through `lib/validation.ts`, and `lib/sales/pricing.ts` prices a sale for both the PowerSync writer and the server action (and gives the cart and payment screens the same totals). Server actions also check the shape of their browser-supplied arguments first (`lib/sales/checkout-request.ts` for checkout). The server-action checkout sends a browser-generated sale id and reuses it on retries, so a retry after a lost response returns the recorded sale instead of a duplicate.

Tenant bootstrap is wired into the root app entry. An authenticated user is resolved through Supabase Auth; if they have no `tenant_users` membership, the server creates a tenant and membership row through Drizzle before rendering the POS.

The home page (`app/page.tsx`) paints the POS from server data without sending the tenant's whole history, whose size would otherwise grow the page with every sale. Products and members come whole. Stock comes as an opening: everything recorded more than 35 days before the request (`RECENT_HISTORY_DAYS`) summed per product in Postgres, plus the movements since then as rows (`getInventorySnapshotForTenant`; see the inventory PRD, §7.2). Sales and refunds are loaded by tenant and date in Postgres, never by a list of sale ids, and in parallel. With PowerSync only the last 35 days of sales and refunds are sent (with the earlier sales those refunds return): they paint Sales and Reports until the device's first sync, after which the local store holds the whole history. Before that first sync, a range older than 35 days shows no sales and Settings counts only the recent ones. Without PowerSync these sales are all the screens have, so every sale is sent, as every range of Reports needs.

## Known Follow-ups

Deferred items that are acceptable for now but should be revisited.

### Product image upload

- **Replaced and orphaned images are deleted, best-effort.** Once Postgres has applied a new `products.image_path`, the image it replaced is deleted: by the `uploadProductImage` server action (service role), and in PowerSync mode by the upload connector (`lib/powersync/connector.ts`) with the user's session. If a newer image from another device won (last-write-wins, per column), the new upload is deleted instead, and so is an upload whose product write failed. A placeholder tone never deletes an image: Postgres keeps an uploaded image over a placeholder that a device with a stale copy of the product sends, and the connector never deletes anything for a placeholder write. Only `<tenant_id>/products/<product_id>/<uuid>.<jpg|png>` objects of that product are ever deleted, never seed images. A crash between upload and cleanup, or an environment without the delete policy, still leaves unused files. A periodic sweep of objects that no product row references would catch those, but it must skip recent objects: a device can upload an image and go offline before its product write reaches the server.
- **Storage enforces the upload rules.** The `product-images` bucket accepts JPEG and PNG up to 5 MiB: [`supabase/manual/20260926130000_product_images_storage_rules.sql`](../supabase/manual/20260926130000_product_images_storage_rules.sql) sets that on hosted projects, and `supabase/config.toml` on the local stack, matching `lib/product-image-config.ts`. The app checks the same rules first only to show a clearer message. Storage compares the declared content type, not the file bytes, so a client can still store other content under an image type. It is served from the Supabase origin, not the app origin, so it cannot run script in the app.
- **Photos are reduced before upload.** The editor redraws a picked photo at most 768 px on its longer side with `downscaleProductImage` (`lib/product-image-downscale.ts`): a JPEG at quality 0.8, or a PNG when the original is a PNG with transparency. Both upload paths send that file, so a phone photo costs a few hundred KB instead of several MB, and the Sell grid never decodes full-size photos. The 5 MiB limit applies to the reduced file; a browser that cannot decode the photo uploads the original, within the limit.
- **Photos are cached on the device.** The service worker (`app/sw.ts`) keeps product photos in the `glitter-pos-product-images` cache (cache-first, up to 300 photos of at most 1 MB, each dropped after 30 days unused), so Sell tiles show them offline, as PRD §7.1 asks. `ProductArt` loads them with `crossOrigin="anonymous"` so the responses are CORS, not opaque, and uploads set a one-year `Cache-Control`, since every upload has a new name. Logout and tenant changes delete the cache with the rest of the user's data.
- **Public bucket is cross-tenant readable.** `product-images` is a public bucket, so any object URL is world-readable and the tenant-scoped path (`<tenantId>/products/<productId>/<uuid>.<ext>`) is guessable. Accepted because product images are not sensitive and the PRD treats them as display assets. Revisit if images ever carry tenant-private information (would require a private bucket plus signed URLs or an RLS-gated read path). See `supabase/migrations/20260607185822_supabase_storage_bucket.sql`.
- **Uploads run with the signed-in user's session.** In PowerSync mode the browser uploads straight to Storage (`uploadProductImageLocal` in `lib/powersync/write-products.ts`). Otherwise the `uploadProductImage` server action checks that the product belongs to the tenant and then uploads with the user's cookie session, not the service role. Either way the Storage INSERT policy allows only `<tenant_id>/products/<product_id>/<uuid>.<jpg|png>` in a tenant the user belongs to (`tenant_users` membership). Every signed-up user gets a tenant, so any account can upload into its own folder; the bucket limits bound each upload. A DELETE policy with the same tenant check lets the app remove images it no longer references. There is no UPDATE policy: every upload gets a fresh name.

### Categories

- **Products name their category; nothing references it by id.** A product stores its category's name, and a sale line keeps the name it was sold under. Postgres keeps them in step for every writer ([`supabase/manual/20260814235910_category_integrity_triggers.sql`](../supabase/manual/20260814235910_category_integrity_triggers.sql), whose functions [`20260930120000_category_triggers_follow_latest_edit.sql`](../supabase/manual/20260930120000_category_triggers_follow_latest_edit.sql) replaces): a rename renames the tenant's products, and a category a product uses cannot be deleted. Names are unique per tenant ignoring case, while those triggers match the exact spelling, so a product whose category matches one of the tenant's categories ignoring case is always stored with that category's spelling ([`20260930130000_products_use_category_spelling.sql`](../supabase/manual/20260930130000_products_use_category_spelling.sql)), whichever of the two arrives first.
- **Offline conflicts converge rather than block.** When two devices offline create the same name, rename to a name the other just created, rename a category the other just deleted, or delete a category the other just used, the connector skips the change that reached the server second (`isLostCategoryConflict` in `lib/powersync/connector.ts`), and the next checkpoint restores the server's categories. A rename that finds no category on the server (deleted elsewhere, or its create was skipped) is skipped the same way, while a products UPDATE that matches no row is still recorded as a failure. A product can still end up under a name no category has: filed under one while another device deleted it, moved to the new name of a rename that was skipped because its category was gone, or a legacy category over 40 characters that the backfill skipped. The category rails and the editor still show such a name, and saving the product keeps it; choosing another category is the way out.
- **Existing catalogs are backfilled on load.** `/` creates a category for every product category name that has none (`ensureCategoriesForExistingProducts`), reading only the missing names. It can go once every tenant has loaded the release (see the upgrade notes).
