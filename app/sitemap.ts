import type { MetadataRoute } from "next";
import { INDEXABLE_PATHS, isIndexableDeployment } from "@/lib/public-site";
import { getRequestOrigin } from "@/lib/request-origin";

// Sitemap URLs must be absolute, so without a trusted origin
// (lib/request-origin.ts) the sitemap lists nothing rather than a guessed host.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getRequestOrigin();
  if (!origin || !isIndexableDeployment()) {
    return [];
  }
  return INDEXABLE_PATHS.map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: "monthly",
  }));
}
