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

Tenant bootstrap is wired into the root app entry. An authenticated user is resolved through Supabase Auth; if they have no `tenant_users` membership, the server creates a tenant and membership row through Drizzle before rendering the POS. The UI still uses the local Zustand product/sales store until Supabase-backed product and sale repositories are connected.

## Categories by id

Products point to their category with `products.category_id` (composite FK
`(category_id, tenant_id) → categories(id, tenant_id)`, `ON DELETE RESTRICT`).
`products.category` stays as a derived name: v0.7.0 clients only send and read
the name, and sale lines snapshot it. The database keeps the two coherent with
the triggers in `supabase/manual/20260929030700_product_category_ids.sql`.

Invariants:

- **I1** `category_id` is the source of truth; the server sets `category` from
  it on every product write.
- **I2** A new or changed `category_id` that belongs to the puesto wins over
  the name. An unknown id (e.g. its category upload was rejected) falls back
  to resolving the name.
- **I3** A name-only change with the same id is a move only when the name
  matches a _different_ existing category, or is one of v0.7.0's four fixed
  categories (Stickers, Prints, Pines, Accesorios; created if missing, since
  those are the only names v0.7.0 can send). Rename cascades, case or spacing
  variants, v0.7.0's save-time aliases (Pegatina(s)→Stickers,
  Lámina(s)→Prints, Pins→Pines), and other stale names in replayed or
  concurrent uploads from before a rename are not moves.
- **I4** Maintenance writes (rename cascade, backfill) never change
  `updated_at`.
- **I5** Clients write `category_id` and `category` together, and only when
  the category changes (`updateProductLocal` compares with the stored id).
- **I6** Catalog-only rejections converge instead of blocking the upload
  queue: a category create/rename that hits `categories_tenant_name_unique`,
  or a category delete refused by the products FK, completes the op and the
  next checkpoint restores server state (`isConvergentCatalogRejection` in
  `lib/powersync/connector.ts`). Financial tables and `products` are never on
  that list. `PGRST204`/`42703` (app ahead of the database schema) are
  recorded as visible sync failures.

Mixed fleet (v0.7.0 and this build side by side):

- A v0.7.0 device can only pick Stickers, Prints, Pines or Accesorios. If a
  newer device renamed or deleted one of them, a v0.7.0 edit or new product
  re-creates it. So can a queued upload from a newer device that still uses
  one of those four names from before the rename.
- Renaming a category named Pegatina(s), Lámina(s) or Pins while a v0.7.0
  device hasn't synced can move that device's next edit into Stickers,
  Prints or Pines (v0.7.0 saves those names instead, and the server can't
  tell the edit is stale).
- Upgrade every device, and let queues drain, before renaming or deleting
  those categories.
- An offline category create/rename that collides with a server name, or a
  delete of a category another device already used, is undone at the next
  sync (logged to the console; no toast yet).
- End condition: once every device runs this build or later and queues are
  drained, `SELECT count(*) FROM products WHERE category_id IS NULL` = 0 allows
  a follow-up migration that sets `category_id NOT NULL`. Dropping
  `products.category` is optional after that.

Trigger order matters. PostgreSQL fires same-event triggers alphabetically:
`products_category_resolve_id` must run before any last-write-wins trigger
(e.g. `products_check_upload_timestamps`, `products_keep_latest_edit`) and
`products_sync_category_name` after it, so the id is arbitrated first and the
name is always re-derived from the winner.

## Known Follow-ups

Deferred items that are acceptable for the current slice but should be revisited. None block the current Stage A work.

### Product image upload

- **Orphaned images on replace.** Uploading a replacement image generates a fresh UUID object path and overwrites `products.image_path`, but the previous object is never removed from Storage. Over many edits this leaks storage. Fix later by deleting the old object on successful replace, or with a periodic sweep that drops objects not referenced by any product row. See `app/products/actions.ts` (`uploadProductImage`) and `lib/products/repository.ts` (`updateProductImageForTenant`).
- **No bucket-level size/MIME enforcement.** Validation lives only in the `uploadProductImage` server action, and the MIME check trusts the browser-provided `image.type`, which is spoofable. Low risk today (admin-key upload of non-sensitive, publicly readable images). Defense-in-depth: set `file_size_limit` and `allowed_mime_types` on the `product-images` bucket via the bucket migration or `config.toml`.
- **Public bucket is cross-tenant readable.** `product-images` is a public bucket, so any object URL is world-readable and the tenant-scoped path (`<tenantId>/products/<productId>/<uuid>.<ext>`) is guessable. Accepted because product images are not sensitive and the PRD treats them as display assets. Revisit if images ever carry tenant-private information (would require a private bucket plus signed URLs or an RLS-gated read path). See `supabase/migrations/20260607001000_product_images_bucket.sql`.
- **No `authenticated` write policy on `storage.objects` — by design.** The bucket migration grants only public SELECT. Uploads are intentionally server-mediated: `uploadProductImage` in `app/products/actions.ts` uses the service-role client (`createAdminClient`), which bypasses RLS, and writes to a tenant-scoped path. There is deliberately no INSERT/DELETE policy for the `authenticated` role, so a logged-in user cannot write to the bucket directly with their own JWT. If uploads ever move client-side (direct-to-Storage), do not add a blanket `authenticated` policy — scope it to the caller's tenant, e.g. `WITH CHECK (bucket_id = 'product-images' AND public.current_user_has_tenant((storage.foldername(name))[1]::uuid))`, otherwise any user could write/delete other tenants' images in this public bucket.
