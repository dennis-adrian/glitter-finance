// Local-first product write helpers. Mirror the server-side repository in
// lib/products/repository.ts (placeholder normalization, updated_at handling)
// but write to the per-device PowerSync SQLite store; PowerSync's CRUD
// queue uploads the changes to Supabase via SupabaseConnector.uploadData.
//
// Image upload goes directly from the browser to Supabase Storage using the
// user's JWT (gated by the policy in supabase/migrations/...product_image_upload_policy.sql).
// The metadata write to products.image_path stays in the local SQLite store,
// which PowerSync replicates to Postgres alongside other product writes.

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encodePlaceholderImagePath } from "@/lib/product-mapper";
import {
  isPlaceholderImagePath,
  productImageMaxBytes,
  productImageMimeTypes,
  productImagesBucket,
} from "@/lib/product-image-config";
import type { ProductInput } from "@/lib/types";

const imageExtensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

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
  input.assertCurrent?.();
  await db.execute(
    `UPDATE products
       SET name = ?, price_cents = ?, cost_cents = ?, category = ?,
           image_path = ?, tracks_inventory = ?, low_stock_threshold = ?,
           updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [
      input.product.name,
      input.product.priceCents,
      input.product.costCents,
      input.product.category,
      resolveInputImagePath(input.product),
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

  const extension = imageExtensionByMimeType[file.type] ?? "jpg";
  const objectPath = `${tenantId}/products/${productId}/${uuid()}.${extension}`;

  input.assertCurrent?.();
  const { error } = await supabase.storage
    .from(productImagesBucket)
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(`No se pudo subir la imagen: ${error.message}`);
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
    // accumulate dead files. Best-effort: log if removal also fails, but
    // surface the original DB error to the caller. We don't gate on a
    // "no rows affected" check because PowerSync's view system can report
    // rowsAffected: 0 even for successful UPDATEs without a RETURNING
    // clause — false positives there would delete just-uploaded images.
    const { error: removeError } = await supabase.storage
      .from(productImagesBucket)
      .remove([objectPath]);
    if (removeError) {
      console.error(
        "[uploadProductImageLocal] orphan cleanup failed after DB error",
        { objectPath, removeError }
      );
    }
    throw dbError;
  }
}
