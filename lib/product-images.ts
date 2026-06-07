import { getPublicEnv } from "@/lib/env";
import {
  isPlaceholderImagePath,
  placeholderImagePrefix,
  productImagesBucket,
} from "@/lib/product-image-config";

export { isPlaceholderImagePath, placeholderImagePrefix, productImagesBucket };

export function getProductImagePublicUrl(path: string | null | undefined) {
  if (isPlaceholderImagePath(path)) {
    return null;
  }

  const imagePath = path ?? "";
  const encodedPath = imagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const supabaseUrl = getPublicEnv().supabaseUrl.replace(/\/$/, "");

  return `${supabaseUrl}/storage/v1/object/public/${productImagesBucket}/${encodedPath}`;
}
