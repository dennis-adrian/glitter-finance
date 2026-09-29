// Local-first product write helpers. Mirror the server-side repository in
// lib/products/repository.ts (placeholder normalization, updated_at handling)
// but write to the per-device PowerSync SQLite store; PowerSync's CRUD
// queue uploads the changes to Supabase via SupabaseConnector.uploadData.
//
// Every UPDATE sets updated_at to the device time of the edit. Postgres keeps,
// column by column, the newer of two edits by that value
// (supabase/manual/20260926130100_products_last_write_wins.sql), so an UPDATE
// without it could never win over an edit another device made meanwhile.
//
// Image upload goes directly from the browser to Supabase Storage using the
// user's JWT, within the bucket limits and tenant-folder policies in
// supabase/manual/20260926130000_product_images_storage_rules.sql.
// The metadata write to products.image_path stays in the local SQLite store,
// which PowerSync replicates to Postgres alongside other product writes. The
// connector deletes the image an upload replaced once Postgres has applied the
// new path.

import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { nowIso } from "@/lib/dates";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductImageObjectPath,
  encodePlaceholderImagePath,
  productImageCacheControl,
  isPlaceholderImagePath,
  placeholderImagePathPattern,
  productImageFileError,
  productImagesBucket,
} from "@/lib/product-image-config";
import { removeProductImageObjects } from "@/lib/product-images";
import {
  insertInventoryMovement,
  prepareInventoryMovement,
} from "@/lib/powersync/write-inventory";
import { normalizeProductInput } from "@/lib/products";
import type { ProductInput } from "@/lib/types";

/**
 * Before the first sync completes, the local store holds only this device's
 * own writes, so a product listed from the server-rendered catalog may not
 * be there yet. An UPDATE would then match no row and the edit would be
 * dropped without a word.
 */
export const PRODUCT_NOT_ON_DEVICE_MESSAGE =
  "Este producto todavía se está sincronizando en este dispositivo. Inténtalo de nuevo en un momento.";

async function assertProductOnDevice(
  db: Pick<Transaction, "getOptional">,
  input: { tenantId: string; productId: string }
) {
  const row = await db.getOptional<{ id: string }>(
    `SELECT id FROM products WHERE id = ? AND tenant_id = ?`,
    [input.productId, input.tenantId]
  );
  if (!row) {
    throw new Error(PRODUCT_NOT_ON_DEVICE_MESSAGE);
  }
}

/**
 * The count a product is saved with, recorded as an `initial` movement in the
 * same transaction as the product write: a failed save leaves neither, so a
 * product is never stored without the stock it was entered with.
 */
export type InitialStockInput = { userId: string; delta: number };

function prepareInitialStock(
  tenantId: string,
  productId: string,
  initialStock: InitialStockInput | undefined
) {
  return initialStock
    ? prepareInventoryMovement({
        tenantId,
        productId,
        userId: initialStock.userId,
        delta: initialStock.delta,
        reason: "initial",
      })
    : null;
}

export async function createProductLocal(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    product: ProductInput;
    initialStock?: InitialStockInput;
    assertCurrent?: () => void;
  }
): Promise<{ productId: string }> {
  // Checked here so a row Postgres would reject never enters the upload queue.
  const product = normalizeProductInput(input.product);
  const productId = crypto.randomUUID();
  const initialMovement = prepareInitialStock(
    input.tenantId,
    productId,
    input.initialStock
  );
  const now = nowIso();
  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    await tx.execute(
      `INSERT INTO products
        (id, tenant_id, name, price_cents, cost_cents, category, image_path,
         tracks_inventory, low_stock_threshold, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        input.tenantId,
        product.name,
        product.priceCents,
        product.costCents,
        product.category,
        // A new product starts with a placeholder. An image is attached after
        // the insert, by uploadProductImageLocal.
        encodePlaceholderImagePath(product.imageTone),
        product.tracksInventory ? 1 : 0,
        product.lowStockThreshold ?? null,
        now,
        now,
      ]
    );
    if (initialMovement) {
      await insertInventoryMovement(tx, initialMovement);
    }
  });
  return { productId };
}

export async function updateProductLocal(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    productId: string;
    product: ProductInput;
    initialStock?: InitialStockInput;
    assertCurrent?: () => void;
  }
): Promise<void> {
  // The editor only picks a placeholder tone; uploaded images change through
  // uploadProductImageLocal. The tone applies while the row still shows a
  // placeholder, and an uploaded image is never rewritten here: the editor's
  // copy of image_path can be older than an image another device uploaded
  // meanwhile, and writing it back would restore a replaced (deleted) image.
  // This device's row can be stale too, so the tone may still reach the
  // server over an image another device uploaded; Postgres keeps the image
  // (products_keep_latest_edit), and the connector deletes nothing.
  const product = normalizeProductInput(input.product);
  const placeholderPath = isPlaceholderImagePath(product.imagePath)
    ? encodePlaceholderImagePath(product.imageTone)
    : null;
  const assignments = [
    "name = ?",
    "price_cents = ?",
    "cost_cents = ?",
    "category = ?",
    `image_path = CASE
       WHEN image_path IS NULL OR image_path LIKE ?
         THEN coalesce(?, image_path)
       ELSE image_path
     END`,
  ];
  const params: (string | number | null)[] = [
    product.name,
    product.priceCents,
    product.costCents,
    product.category,
    placeholderImagePathPattern,
    placeholderPath,
  ];
  // Like updateProductForTenant, only the optional fields the caller sent:
  // the editor has no low-stock threshold field, and saving it must not
  // clear a threshold set elsewhere.
  if ("tracksInventory" in product) {
    assignments.push("tracks_inventory = ?");
    params.push(product.tracksInventory ? 1 : 0);
  }
  if ("lowStockThreshold" in product) {
    assignments.push("low_stock_threshold = ?");
    params.push(product.lowStockThreshold ?? null);
  }
  assignments.push("updated_at = ?");
  params.push(nowIso());
  const initialMovement = prepareInitialStock(
    input.tenantId,
    input.productId,
    input.initialStock
  );

  await db.writeTransaction(async (tx) => {
    await assertProductOnDevice(tx, input);
    input.assertCurrent?.();
    await tx.execute(
      `UPDATE products SET ${assignments.join(", ")}
       WHERE id = ? AND tenant_id = ?`,
      [...params, input.productId, input.tenantId]
    );
    if (initialMovement) {
      await insertInventoryMovement(tx, initialMovement);
    }
  });
}

export async function archiveProductLocal(
  db: AbstractPowerSyncDatabase,
  input: { tenantId: string; productId: string; assertCurrent?: () => void }
): Promise<void> {
  const now = nowIso();
  await db.writeTransaction(async (tx) => {
    await assertProductOnDevice(tx, input);
    input.assertCurrent?.();
    await tx.execute(
      `UPDATE products SET archived_at = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND archived_at IS NULL`,
      [now, now, input.productId, input.tenantId]
    );
  });
}

export async function restoreProductLocal(
  db: AbstractPowerSyncDatabase,
  input: { tenantId: string; productId: string; assertCurrent?: () => void }
): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await assertProductOnDevice(tx, input);
    input.assertCurrent?.();
    await tx.execute(
      `UPDATE products SET archived_at = NULL, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [nowIso(), input.productId, input.tenantId]
    );
  });
}

/**
 * Uploads the file to Supabase Storage from the browser using the caller's
 * JWT, then writes the resulting object path into the local products row.
 * Throws on validation failure or upload error; the caller decides whether
 * to surface that to the user as a non-blocking "imagen no se pudo subir"
 * toast (matching the PRD §7.1 non-blocking-images rule).
 */
export async function uploadProductImageLocal(
  supabase: SupabaseClient,
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    productId: string;
    file: File;
    assertCurrent?: () => void;
  }
): Promise<void> {
  const { file, tenantId, productId } = input;

  const fileError = productImageFileError(file);
  if (fileError) {
    throw new Error(fileError);
  }

  const objectPath = buildProductImageObjectPath(
    tenantId,
    productId,
    file.type
  );

  // Checked before uploading, so no object is stored for a row that the
  // metadata write below could not update.
  await assertProductOnDevice(db, { tenantId, productId });
  input.assertCurrent?.();
  const { error } = await supabase.storage
    .from(productImagesBucket)
    .upload(objectPath, file, {
      contentType: file.type,
      cacheControl: productImageCacheControl,
      upsert: false,
    });

  if (error) {
    throw new Error("No se pudo subir la imagen.");
  }

  try {
    input.assertCurrent?.();
    await db.execute(
      `UPDATE products SET image_path = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [objectPath, nowIso(), productId, tenantId]
    );
  } catch (dbError) {
    // Storage upload already succeeded; we couldn't persist the link in
    // local SQLite. Remove the now-orphaned object so the bucket doesn't
    // accumulate dead files. Best-effort: a failed removal is logged, and the
    // caller gets the original DB error. We don't gate on a
    // "no rows affected" check because PowerSync's view system can report
    // rowsAffected: 0 even for successful UPDATEs without a RETURNING
    // clause — false positives there would delete just-uploaded images.
    await removeProductImageObjects(supabase, [objectPath]);
    throw dbError;
  }
}
