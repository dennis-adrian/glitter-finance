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

const uuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const productImageFileNamePattern = new RegExp(
  `^${uuidPattern}\\.(jpg|png)$`,
  "i"
);

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

/**
 * Whether `path` names an uploaded image of this product in this tenant's
 * folder. Placeholders, seed images and other products' images are not.
 */
export function isProductImageObjectPath(
  path: string | null | undefined,
  owner: { tenantId: string; productId: string }
): path is string {
  if (!path || isPlaceholderImagePath(path)) return false;
  const prefix = `${owner.tenantId}/products/${owner.productId}/`;
  return (
    path.toLowerCase().startsWith(prefix.toLowerCase()) &&
    productImageFileNamePattern.test(path.slice(prefix.length))
  );
}

/**
 * The uploaded image that no longer belongs to the product after a write that
 * set products.image_path to `requestedPath`. Postgres keeps the newer of two
 * edits (supabase/manual/20260926130100_products_last_write_wins.sql), so:
 * - the write applied (`storedPath` is `requestedPath`): the image it replaced;
 * - a newer edit won: the image this write uploaded, which nothing references.
 */
export function unreferencedProductImagePaths(input: {
  tenantId: string;
  productId: string;
  requestedPath: string | null | undefined;
  previousPath: string | null | undefined;
  storedPath: string | null | undefined;
}): string[] {
  const unreferenced =
    input.storedPath === input.requestedPath
      ? input.previousPath
      : input.requestedPath;
  return unreferenced !== input.storedPath &&
    isProductImageObjectPath(unreferenced, input)
    ? [unreferenced]
    : [];
}
