/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";
import type {
  PrecacheEntry,
  RuntimeCaching,
  SerwistGlobalConfig,
  SerwistPlugin,
} from "serwist";
import {
  applyAppShellRefresh,
  prepareAppShellRefresh,
} from "../lib/pwa/app-shell";
import {
  OFFLINE_PAGE_URL,
  PAGE_CACHE_NAME,
  POWERSYNC_WASM_CACHE_NAME,
  PRODUCT_IMAGE_CACHE_NAME,
  PRODUCT_IMAGE_PATH_PREFIX,
  STATIC_CACHE_NAME,
  SW_CACHE_ID,
} from "../lib/pwa/cache-names";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const isSupabaseOrPowerSync = ({ url }: { url: URL }) =>
  /(?:supabase\.co|powersync\.(?:com|journeyapps\.com))$/i.test(url.hostname);
const isManifestRequest = (pathname: string) =>
  /\.webmanifest$/i.test(pathname);
const isIdentitySensitivePath = (pathname: string) =>
  pathname === "/login" ||
  pathname.startsWith("/login/") ||
  pathname === "/join" ||
  pathname.startsWith("/join/") ||
  pathname === "/auth" ||
  pathname.startsWith("/auth/");

// Photos the editor uploads are a few hundred KB (downscaleProductImage).
// Larger, older originals are left to the HTTP cache, so the photo cache
// cannot crowd the storage quota the local database shares.
const PRODUCT_IMAGE_MAX_CACHED_BYTES = 1024 * 1024;
const skipLargeResponses: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) => {
    const length = Number(response.headers.get("content-length"));
    return Number.isFinite(length) && length > PRODUCT_IMAGE_MAX_CACHED_BYTES
      ? null
      : response;
  },
};

const runtimeCaching: RuntimeCaching[] = [
  // Product photos (public Supabase Storage objects), so Sell tiles keep
  // them offline. Each upload gets a new object name, so a cached photo is
  // never stale. ProductArt requests them with CORS: an opaque response
  // could not be checked here, and Chrome counts each one as several MB of
  // quota. Logout clears this cache (clearUserDataCaches).
  {
    matcher: ({ url }) => url.pathname.startsWith(PRODUCT_IMAGE_PATH_PREFIX),
    handler: new CacheFirst({
      cacheName: PRODUCT_IMAGE_CACHE_NAME,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        skipLargeResponses,
        new ExpirationPlugin({
          maxEntries: 300,
          maxAgeSeconds: 30 * 24 * 60 * 60,
          maxAgeFrom: "last-used",
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // Every other Supabase and PowerSync request: synced data belongs to
  // PowerSync and the local database, never to a cache.
  {
    matcher: isSupabaseOrPowerSync,
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ sameOrigin, url }) =>
      sameOrigin &&
      (url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/auth/") ||
        url.pathname === "/monitoring" ||
        url.pathname.startsWith("/serwist/")),
    handler: new NetworkOnly(),
  },
  // The app shell. Every online navigation to "/" stores the page here, and
  // an offline launch (or a network slower than 3 s) opens Sell Mode from
  // it. Only complete pages are kept: a redirect to /login (a lapsed
  // session) must not replace the last working shell. There is no age
  // limit, because a vendor may reach a fair offline days after last opening
  // the app online; logout clears this cache (clearUserDataCaches).
  {
    matcher: ({ request, sameOrigin, url }) =>
      sameOrigin &&
      request.mode === "navigate" &&
      !isIdentitySensitivePath(url.pathname),
    handler: new NetworkFirst({
      cacheName: PAGE_CACHE_NAME,
      networkTimeoutSeconds: 3,
      // "/?from=pwa" can open the shell stored for "/".
      matchOptions: { ignoreSearch: true, ignoreVary: true },
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 16 }),
      ],
    }),
  },
  // PowerSync's SQLite .wasm. The one the app loads is precached
  // (lib/pwa/powersync-precache.ts); this rule keeps any other one available
  // offline, rather than in defaultCache's "others", which expires in a day.
  // The names are content hashes, so a cached file is never stale.
  {
    matcher: ({ sameOrigin, url }) =>
      sameOrigin &&
      url.pathname.startsWith("/@powersync/") &&
      url.pathname.endsWith(".wasm"),
    handler: new CacheFirst({
      cacheName: POWERSYNC_WASM_CACHE_NAME,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 4 }),
      ],
    }),
  },
  {
    matcher: ({ sameOrigin, url }) =>
      sameOrigin &&
      (url.pathname.startsWith("/_next/static/") ||
        (/\.(?:css|js|svg|png|jpg|jpeg|webp|ico)$/i.test(url.pathname) &&
          !isManifestRequest(url.pathname))),
    handler: new StaleWhileRevalidate({
      cacheName: STATIC_CACHE_NAME,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 96,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    }),
  },
  {
    matcher: ({ sameOrigin, url }) =>
      sameOrigin && isIdentitySensitivePath(url.pathname),
    handler: new NetworkOnly(),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  cacheId: SW_CACHE_ID,
  clientsClaim: true,
  navigationPreload: true,
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
  },
  runtimeCaching,
  // OFFLINE_PAGE_URL answers the first launch offline, /login offline, or a
  // launch after logout cleared the cached app shell.
  // Not precacheOptions.navigateFallback: its route answers every navigation
  // before runtimeCaching runs, so the page cache above would never be read
  // and an offline launch would always land here instead of Sell Mode. A
  // fallback only answers once a navigation's own strategy has failed.
  fallbacks: {
    entries: [
      {
        url: OFFLINE_PAGE_URL,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
  // A new build takes over as soon as it has installed. Open pages keep the
  // code they loaded (the app has no lazily loaded routes and navigates with
  // full page loads), and the next launch, online or offline, starts the
  // new build: the app shell refresh below keeps the cached pages in step
  // with the new precache.
  skipWaiting: true,
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    prepareAppShellRefresh({
      caches: self.caches,
      fetch: self.fetch.bind(self),
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(applyAppShellRefresh({ caches: self.caches }));
});

serwist.addEventListeners();
