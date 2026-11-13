import type { MetadataRoute } from "next";
import { isIndexableDeployment, ROBOTS_DISALLOW } from "@/lib/public-site";
import { getRequestOrigin } from "@/lib/request-origin";

// Crawlers may fetch every page; the ones that must stay out of search
// results answer with X-Robots-Tag: noindex instead (NOINDEX_SOURCES in
// lib/public-site.ts explains why they are not disallowed here). A Vercel
// preview (staging) is closed to crawlers altogether.
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!isIndexableDeployment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  const origin = await getRequestOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...ROBOTS_DISALLOW],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
