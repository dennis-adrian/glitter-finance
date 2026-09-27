import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import {
  isPlaceholderImagePath,
  productImagePublicPathPrefix,
  productImagesBucket,
} from "@/lib/product-image-config";

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

  return `${supabaseUrl}${productImagePublicPathPrefix}${encodedPath}`;
}

/**
 * Best-effort removal of product images that no product references any more.
 * A failure only leaves an unused file in the bucket, so it is logged and
 * never thrown. Clients without the service role need the delete policy in
 * supabase/manual/20260926130000_product_images_storage_rules.sql; without it
 * Storage removes nothing and reports no error.
 */
export async function removeProductImageObjects(
  supabase: SupabaseClient,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await supabase.storage
      .from(productImagesBucket)
      .remove(paths);
    if (error) {
      console.warn("[product-images] could not remove unused images", {
        paths,
        error,
      });
    }
  } catch (error) {
    console.warn("[product-images] could not remove unused images", {
      paths,
      error,
    });
  }
}
