export const productImagesBucket = "product-images";
export const productImageMaxBytes = 5 * 1024 * 1024;
export const productImageMimeTypes = ["image/jpeg", "image/png"] as const;

export const placeholderImagePrefix = "placeholder:";

export function isPlaceholderImagePath(path: string | null | undefined) {
  return !path || path.startsWith(placeholderImagePrefix);
}
