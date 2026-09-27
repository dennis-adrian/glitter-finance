// Storage enforces the same size, type and path rules:
// supabase/manual/20260926130000_product_images_storage_rules.sql (hosted)
// and supabase/config.toml (local stack). Keep them in step.
export const productImagesBucket = "product-images";
export const productImageMaxBytes = 5 * 1024 * 1024;
export const productImageMimeTypes = ["image/jpeg", "image/png"] as const;

export const placeholderImagePrefix = "placeholder:";

const productImageExtensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function isPlaceholderImagePath(path: string | null | undefined) {
  return !path || path.startsWith(placeholderImagePrefix);
}

/**
 * A fresh object path for a product image:
 * <tenant_id>/products/<product_id>/<uuid>.<jpg|png>. Every upload gets a new
 * name, so a replaced image never overwrites the object other devices still
 * show until they sync.
 */
export function buildProductImageObjectPath(
  tenantId: string,
  productId: string,
  mimeType: string
) {
  const extension = productImageExtensionByMimeType[mimeType] ?? "jpg";
  return `${tenantId}/products/${productId}/${crypto.randomUUID()}.${extension}`;
}
