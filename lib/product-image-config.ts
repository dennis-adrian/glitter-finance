// The product image rules, shared by the editor, the uploadProductImage server
// action, the PowerSync writer, the repository and the mapper.
//
// Storage enforces the same size, type and path rules:
// supabase/manual/20260926130000_product_images_storage_rules.sql (hosted)
// and supabase/config.toml (local stack). Keep them in step.
export const productImagesBucket = "product-images";
export const productImageMaxBytes = 5 * 1024 * 1024;
export const productImageMimeTypes = ["image/jpeg", "image/png"] as const;

export type ProductImageMimeType = (typeof productImageMimeTypes)[number];

/**
 * Cache-Control max-age, in seconds, set on uploaded images. Every upload gets
 * a new object name (buildProductImageObjectPath), so a URL's content never
 * changes and browsers and the Storage CDN may keep it for a year.
 */
export const productImageCacheControl = String(365 * 24 * 60 * 60);

/** Path of the bucket's public object URLs (getProductImagePublicUrl). */
export const productImagePublicPathPrefix = `/storage/v1/object/public/${productImagesBucket}/`;

const productImageExtensionByMimeType: Record<ProductImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

const productImageFormats = productImageMimeTypes.map((type) =>
  productImageExtensionByMimeType[type].toUpperCase()
);

/** "5 MB": the size limit as the editor and its messages show it. */
export const productImageMaxSizeLabel = `${productImageMaxBytes / (1024 * 1024)} MB`;

/** "JPG y PNG": the accepted formats, for the editor's hint. */
export const productImageFormatsLabel = new Intl.ListFormat("es", {
  type: "conjunction",
}).format(productImageFormats);

/** The file input's `accept` attribute. */
export const productImageAccept = productImageMimeTypes.join(",");

export const PRODUCT_IMAGE_TYPE_MESSAGE = `La imagen debe estar en formato ${new Intl.ListFormat(
  "es",
  { type: "disjunction" }
).format(productImageFormats)}.`;
export const PRODUCT_IMAGE_EMPTY_MESSAGE = "La imagen seleccionada está vacía.";
export const PRODUCT_IMAGE_TOO_LARGE_MESSAGE = `La imagen no puede superar ${productImageMaxSizeLabel}.`;

export function isProductImageMimeType(
  type: string
): type is ProductImageMimeType {
  return productImageMimeTypes.some((allowed) => allowed === type);
}

/**
 * Why Storage would refuse this file (its declared type or size), or null
 * when it can be uploaded.
 */
export function productImageFileError(file: {
  size: number;
  type: string;
}): string | null {
  if (!isProductImageMimeType(file.type)) return PRODUCT_IMAGE_TYPE_MESSAGE;
  if (file.size <= 0) return PRODUCT_IMAGE_EMPTY_MESSAGE;
  if (file.size > productImageMaxBytes) return PRODUCT_IMAGE_TOO_LARGE_MESSAGE;
  return null;
}

// A product without an uploaded image stores "placeholder:<tone>" in
// products.image_path, and its tile shows the tone's gradient (app/globals.css).
export const placeholderImagePrefix = "placeholder:";

/** SQL LIKE pattern matching every placeholder image_path. */
export const placeholderImagePathPattern = `${placeholderImagePrefix}%`;

export const placeholderImageTones = [
  "aurora",
  "coral",
  "linen",
  "violet",
  "warm",
] as const;

export type PlaceholderImageTone = (typeof placeholderImageTones)[number];

export const defaultPlaceholderImageTone: PlaceholderImageTone = "violet";

export function isPlaceholderImageTone(
  tone: string | null | undefined
): tone is PlaceholderImageTone {
  return placeholderImageTones.some((known) => known === tone);
}

export function isPlaceholderImagePath(path: string | null | undefined) {
  return !path || path.startsWith(placeholderImagePrefix);
}

/** The image_path of a placeholder in `tone`, or in the default tone. */
export function encodePlaceholderImagePath(tone?: string | null) {
  return `${placeholderImagePrefix}${
    isPlaceholderImageTone(tone) ? tone : defaultPlaceholderImageTone
  }`;
}

/** The tone a placeholder image_path names, or null for any other path. */
export function placeholderImageTone(
  path: string | null | undefined
): PlaceholderImageTone | null {
  if (!path?.startsWith(placeholderImagePrefix)) return null;
  const tone = path.slice(placeholderImagePrefix.length);
  return isPlaceholderImageTone(tone) ? tone : null;
}

const uuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const productImageFileNamePattern = new RegExp(
  `^${uuidPattern}\\.(${Object.values(productImageExtensionByMimeType).join("|")})$`,
  "i"
);

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
  const extension = isProductImageMimeType(mimeType)
    ? productImageExtensionByMimeType[mimeType]
    : productImageExtensionByMimeType["image/jpeg"];
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
