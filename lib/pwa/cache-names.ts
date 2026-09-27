// Cache Storage names and URLs shared by the service worker (app/sw.ts,
// lib/pwa/app-shell.ts), the route that builds it and the local data
// teardown (lib/powersync/local-data-teardown.ts). This file has no imports
// because the service worker bundle includes it.

/** Serwist's cacheId: the precache is "glitter-pos-precache-v2-<scope>". */
export const SW_CACHE_ID = "glitter-pos";

/**
 * The precached page (app/~offline/page.tsx) shown for a page navigation
 * that neither the network nor the page cache can answer.
 */
export const OFFLINE_PAGE_URL = "/~offline";

/** Navigations: the app shell, rendered with the signed-in user's data. */
export const PAGE_CACHE_NAME = "glitter-pos-pages";

/**
 * The app shell fetched from a new build while its service worker installs;
 * it replaces PAGE_CACHE_NAME's pages on activation (lib/pwa/app-shell.ts).
 */
export const NEXT_PAGE_CACHE_NAME = "glitter-pos-pages-next";

/** Same-origin build assets the precache does not cover. */
export const STATIC_CACHE_NAME = "glitter-pos-static";

/** PowerSync's content-hashed SQLite .wasm files. */
export const POWERSYNC_WASM_CACHE_NAME = "glitter-pos-static-powersync";

/** Product photos from Supabase Storage: the tenant's catalog. */
export const PRODUCT_IMAGE_CACHE_NAME = "glitter-pos-product-images";

/**
 * Path of public product photo URLs (productImagePublicPathPrefix in
 * lib/product-image-config.ts, repeated here to keep that module out of the
 * service worker bundle).
 */
export const PRODUCT_IMAGE_PATH_PREFIX =
  "/storage/v1/object/public/product-images/";

/**
 * Caches that only ever hold build assets: the precache and the static asset
 * caches. Nothing in them belongs to a user or tenant, and the app needs them
 * to start offline, so the local data teardown keeps them and deletes every
 * other cache on the origin, including the ones Serwist's defaultCache
 * creates ("others", "pages", "pages-rsc", ...).
 */
export function isStaticAssetCacheName(name: string) {
  return (
    name === STATIC_CACHE_NAME ||
    name.startsWith(`${STATIC_CACHE_NAME}-`) ||
    name === `${SW_CACHE_ID}-precache` ||
    name.startsWith(`${SW_CACHE_ID}-precache-`)
  );
}
