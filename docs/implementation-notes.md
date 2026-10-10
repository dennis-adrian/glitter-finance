# Billetera Ferial Implementation Notes

## Current State

The app covers the code for the PRD's build stages A to D (see the README) on its production architecture: Supabase Auth and Postgres, Drizzle for the schema and the server repositories, and PowerSync for the per-device SQLite store the screens read and write.

Implemented now:

- Mobile-first, responsive Next.js app (bottom navigation on phones, a side rail from tablets up), installable as a PWA, with an offline app shell through Serwist. Screens live in the URL hash (`lib/views.ts`), so back, refresh, and deep links work while the document stays `/`.
- Vender is the default landing screen: tap a product to add it; its `−` button or a long press takes one off.
- The order (pedido) panel, beside the grid on desktops and a sheet from the checkout bar on phones and tablets, with quantity controls and per-line discounts (an amount or a percentage, with an optional reason), **Vaciar** with an undo toast, and a draft order that survives a reload.
- A checkout screen with a sale-level discount (presets, or a custom amount or percentage), cash (received amount and change) or QR, and an explicit **Registrar venta** step; choosing a payment method records nothing. A confirmation screen follows, with a shareable receipt.
- Immutable sales with snapshotted product price, cost, category, and quantity.
- A sales list with each sale's detail (side by side on desktops), voids within the void window, and refunds.
- Reports, in the main navigation, over today, week, month, or a custom range: totals compared with the previous period, a trend chart, and breakdowns by category, payment method, product, and seller.
- Optional stock tracking per product.
- Categories each puesto manages (create, rename, delete when unused) from Catálogo › Categorías; every product points to one by id.
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

Every writer checks input with the same shared rules before anything is written, so a value Postgres would reject never enters the PowerSync upload queue, where a data error blocks every later upload from the device. Amounts are parsed by `lib/money.ts` (es-BO grouping, `MAX_PRICE_CENTS`), stock amounts are bounded by `MAX_QUANTITY` and the movement sign rules in `lib/inventory.ts`, products go through `normalizeProductInput` (`lib/products.ts`, which also checks that `categoryId` is a uuid), ids and notes through `lib/validation.ts`, and `lib/sales/pricing.ts` prices a sale for both the PowerSync writer and the server action (and gives the order panel and the checkout screen the same totals). Server actions also check the shape of their browser-supplied arguments first (`lib/sales/checkout-request.ts` for checkout). The server-action checkout sends a browser-generated sale id and reuses it on retries, so a retry after a lost response returns the recorded sale instead of a duplicate.

Tenant bootstrap is wired into the root app entry. An authenticated user is resolved through Supabase Auth; if they have no `tenant_users` membership, the server creates a tenant and membership row through Drizzle before rendering the POS.

The home page (`app/page.tsx`) paints the POS from server data without sending the tenant's whole history, whose size would otherwise grow the page with every sale. Products and members come whole. Stock comes as an opening: everything recorded more than 35 days before the request (`RECENT_HISTORY_DAYS`) summed per product in Postgres, plus the movements since then as rows (`getInventorySnapshotForTenant`; see the inventory PRD, §7.2). Sales and refunds are loaded by tenant and date in Postgres, never by a list of sale ids, and in parallel. With PowerSync only the last 35 days of sales and refunds are sent (with the earlier sales those refunds return): they paint Sales and Reports until the device's first sync, after which the local store holds the whole history. Before that first sync, a range older than 35 days shows no sales and Settings counts only the recent ones. Without PowerSync these sales are all the screens have, so every sale is sent, as every range of Reports needs.

## Categories by id

Products point to their category with `products.category_id` (composite FK
`products_category_id_tenant_id_categories_id_tenant_id_fk`,
`(category_id, tenant_id) → categories(id, tenant_id)`, which refuses to
delete a category in use with 23503). `products.category` stays as a derived
name: v0.7.0 and v0.8.0 clients only send and read the name, and sale lines
snapshot it. The database keeps the two coherent for every writer with the
triggers in
[`supabase/manual/20261009120000_product_category_ids.sql`](../supabase/manual/20261009120000_product_category_ids.sql).
That file replaces the name-based triggers of `20260814235910`,
`20260930120000` and `20260930130000`, which may already be on an environment
and so are not edited: it drops their triggers and functions, and must run
again after any re-run of them. It needs none of the later manual files, so
an upgrade runs it right after `db:push`, before the app build that writes
`category_id` is deployed (without its triggers, an id the server lacks fails
the FK with 23503 and holds that device's uploads), and again after
`20260930130000` (`docs/upgrade-notes.md`, steps 3 and 6). `category_id`
stays nullable (see the end condition below). Until the file has linked every
product, the app files a product without an id under the category of the
same name (`effectiveCategoryId` in `lib/products.ts`).

Invariants:

- **I1** `category_id` is the source of truth; the server sets `category` from
  it on every product write.
- **I2** A new or changed `category_id` that belongs to the puesto wins over
  the name. A missing or unknown id (an older client, or a category whose
  create lost to another device's) resolves by name: the category of that
  name ignoring case, then v0.7.0's alias, and otherwise a new category. A
  name the app refuses for a category (blank, or “Todos”) files the product
  under “Sin categoría”, and a name over 40 characters is cut to 40.
- **I3** A name-only change with the same id is a move only when the name
  matches a _different_ existing category, or is one of v0.7.0's four fixed
  categories (Stickers, Prints, Pines, Accesorios; created if missing, since
  those are the only names v0.7.0 can send). Rename cascades, case or spacing
  variants, v0.7.0's save-time aliases (Pegatina(s)→Stickers,
  Lámina(s)→Prints, Pins→Pines), and other stale names in replayed or
  concurrent uploads from before a rename are not moves.
- **I4** Maintenance writes (rename cascade, backfill) never change
  `updated_at`. `products_keep_latest_edit` (per-field last-write-wins)
  applies every write that leaves `updated_at` unchanged, so a rename also
  reaches a product last edited by a device whose clock is ahead, and
  `updated_at` never moves back. The backfill turns that trigger off around
  its own statements, inside the transaction.
- **I5** Clients write `category_id` and `category` together, and only when
  the category changes (`updateProductLocal` and `updateProductForTenant`
  compare with the stored id; an update with `categoryId: null` keeps the
  category). A category rename is one categories UPDATE; its products follow
  by id.
- **I6** A category write that lost to another device's converges instead of
  blocking the upload queue (`isLostCategoryConflict` in
  `lib/powersync/connector.ts`): a create or rename that hits
  `categories_tenant_name_unique` (23505), a rename that matches no row, and a
  delete the products FK refuses (23503) are skipped, and the next checkpoint
  restores the server's categories. Only `categories` operations qualify:
  financial tables and `products` never do, and a products UPDATE that
  matches no row is still a failure. A schema mismatch (`PGRST202`,
  `PGRST204`, `42883`, `42703`: the app is ahead of the database) is recorded
  as a sync failure whose message says what to do.

A category never moves to another puesto: `categories_prevent_tenant_move`
refuses any `tenant_id` change with 23514.

Mixed fleet (v0.7.0, v0.8.0 and this build side by side):

- A v0.7.0 device can only pick Stickers, Prints, Pines or Accesorios. If a
  newer device renamed or deleted one of them, a v0.7.0 edit or new product
  re-creates it. So can a queued upload from a newer device that still uses
  one of those four names from before the rename.
- Renaming a category named Pegatina(s), Lámina(s) or Pins while a v0.7.0
  device hasn't synced can move that device's next edit into Stickers,
  Prints or Pines (v0.7.0 saves those names instead, and the server can't
  tell the edit is stale).
- A v0.8.0 device sends any of the puesto's category names. Its rename
  uploads the categories PATCH, then products PATCHes with the new name: the
  cascade has already renamed those products, and the name resolves to the
  same id, so nothing moves.
- A new v0.7.0 or v0.8.0 product filed under a category another device
  deleted brings that category back (I2). Moving an existing product there
  is ignored, and the product keeps its category (I3), unless the name is one
  of v0.7.0's four fixed categories, which is re-created.
- v0.7.0 and v0.8.0 treat every 23xxx error as fatal and cannot discard an
  upload. A v0.8.0 create or rename that collides with a server name (23505),
  or a delete of a category in use (23503), holds that device's queue until
  it updates, as on v0.8.0 today; this build's connector then skips it (I6).
- On this build, an offline category create/rename that collides with a
  server name, or a delete of a category another device already used, is
  undone at the next sync (logged to the console; no toast yet).
- Upgrade every device, and let queues drain, before renaming or deleting
  the four fixed categories or their aliases.
- End condition: once no v0.7.0 or v0.8.0 device remains and queues are
  drained, `SELECT count(*) FROM products WHERE category_id IS NULL` = 0 allows
  a follow-up migration that sets `category_id NOT NULL`. Dropping
  `products.category`, and the name resolution in
  `products_category_resolve_id`, is optional after that.

Trigger order matters. PostgreSQL fires same-event triggers in name order.
The products BEFORE triggers run as `products_category_resolve_id` <
`products_check_upload_timestamps` (INSERT only) <
`products_keep_latest_edit` < `products_sync_category_name`: the id is
resolved first, so last-write-wins judges it like any other column, and the
name is re-derived from whichever id won. On `categories`,
`categories_prevent_tenant_move` runs BEFORE UPDATE OF `tenant_id` and
`categories_cascade_name_to_products` AFTER UPDATE OF `name`. Resolving a
name can race another session creating the same category; it then raises
40001, which the connector retries.

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

- **Products keep a derived name.** `products.category` and the name resolution in `products_category_resolve_id` are there only for v0.7.0 and v0.8.0 clients and the uploads they have queued. Once none remain (see the end condition under Categories by id), `category_id` can become `NOT NULL` and the name column can go.
- **Older clients can bring a deleted category back.** A new product from a v0.7.0 or v0.8.0 client that names a category another device deleted re-creates it, since the server cannot tell the name is stale. Deleting it again once those devices have updated is the way out.
- **Older clients' moves into a deleted category are dropped.** A v0.7.0 or v0.8.0 edit that only changes an existing product's category name to a category another device deleted is ignored (I3): the product keeps its category, and the device gets no error. Only v0.7.0's four fixed categories are re-created. Resolving such names would also take stale names from replayed uploads as moves.
- **Undone category changes are silent.** When the connector skips a category change that lost to another device's (I6), the device only logs it to the console; the next checkpoint puts the server's categories back without a toast.
- **Existing catalogs are linked in SQL, not on load.** The manual file links every product to its category in the same transaction as its triggers, creating the categories that are missing, so `/` no longer backfills categories (`ensureCategoriesForExistingProducts` is gone). Until the file runs, products without an id are grouped by their name in the filters and the editor.
