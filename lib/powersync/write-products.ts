// Local-first product write helpers. Mirror the server-side repository in
// lib/products/repository.ts (placeholder normalization, updated_at handling)
// but write to the per-device PowerSync SQLite store; PowerSync's CRUD
// queue uploads the changes to Supabase via SupabaseConnector.uploadData.
//
// Every UPDATE sets updated_at to the device time of the edit. Postgres keeps
// the newer of two edits by that value
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

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encodePlaceholderImagePath } from "@/lib/product-mapper";
import {
  buildProductImageObjectPath,
  isPlaceholderImagePath,
  placeholderImagePrefix,
  productImageMaxBytes,
  productImageMimeTypes,
  productImagesBucket,
} from "@/lib/product-image-config";
import { removeProductImageObjects } from "@/lib/product-images";
import type { ProductInput } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function resolveInputImagePath(input: ProductInput): string {
  if (isPlaceholderImagePath(input.imagePath)) {
    return encodePlaceholderImagePath(input.imageTone);
  }
  return input.imagePath as string;
}

export async function createProductLocal(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    product: ProductInput;
    assertCurrent?: () => void;
  }
): Promise<{ productId: string }> {
  const productId = uuid();
  const now = nowIso();
  input.assertCurrent?.();
  await db.execute(
    `INSERT INTO products
      (id, tenant_id, name, price_cents, cost_cents, category, image_path,
       tracks_inventory, low_stock_threshold, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      input.tenantId,
      input.product.name,
      input.product.priceCents,
      input.product.costCents,
      input.product.category,
      resolveInputImagePath(input.product),
      input.product.tracksInventory ? 1 : 0,
      input.product.lowStockThreshold ?? null,
      now,
      now,
    ]
  );
  return { productId };
}

export async function updateProductLocal(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    productId: string;
    product: ProductInput;
    assertCurrent?: () => void;
  }
): Promise<void> {
  // The editor only picks a placeholder tone; uploaded images change through
  // uploadProductImageLocal. The tone applies while the row still shows a
  // placeholder, and an uploaded image is never rewritten here: the editor's
  // copy of image_path can be older than an image another device uploaded
  // meanwhile, and writing it back would restore a replaced (deleted) image.
  const placeholderPath = isPlaceholderImagePath(input.product.imagePath)
    ? encodePlaceholderImagePath(input.product.imageTone)
    : null;
  input.assertCurrent?.();
  await db.execute(
    `UPDATE products
       SET name = ?, price_cents = ?, cost_cents = ?, category = ?,
           image_path = CASE
             WHEN image_path IS NULL OR image_path LIKE ?
               THEN coalesce(?, image_path)
             ELSE image_path
           END,
           tracks_inventory = ?, low_stock_threshold = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [
      input.product.name,
      input.product.priceCents,
      input.product.costCents,
      input.product.category,
      `${placeholderImagePrefix}%`,
      placeholderPath,
      input.product.tracksInventory ? 1 : 0,
      input.product.lowStockThreshold ?? null,
      nowIso(),
      input.productId,
      input.tenantId,
    ]
  );
}

export async function archiveProductLocal(
  db: AbstractPowerSyncDatabase,
  input: { tenantId: string; productId: string; assertCurrent?: () => void }
): Promise<void> {
  const now = nowIso();
  input.assertCurrent?.();
  await db.execute(
    `UPDATE products SET archived_at = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ? AND archived_at IS NULL`,
    [now, now, input.productId, input.tenantId]
  );
}

export async function restoreProductLocal(
  db: AbstractPowerSyncDatabase,
  input: { tenantId: string; productId: string; assertCurrent?: () => void }
): Promise<void> {
  input.assertCurrent?.();
  await db.execute(
    `UPDATE products SET archived_at = NULL, updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [nowIso(), input.productId, input.tenantId]
  );
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

  if (file.size <= 0) {
    throw new Error("La imagen seleccionada está vacía.");
  }
  if (file.size > productImageMaxBytes) {
    throw new Error("La imagen no puede superar 5MB.");
  }
  if (!productImageMimeTypes.some((type) => type === file.type)) {
    throw new Error("La imagen debe estar en formato JPG o PNG.");
  }

  const objectPath = buildProductImageObjectPath(
    tenantId,
    productId,
    file.type
  );

  input.assertCurrent?.();
  const { error } = await supabase.storage
    .from(productImagesBucket)
    .upload(objectPath, file, {
      contentType: file.type,
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
