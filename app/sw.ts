/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import {
  CacheableResponsePlugin,
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
} from "serwist";
import {
  PAGE_CACHE_NAME,
  STATIC_CACHE_NAME,
  SW_CACHE_ID,
} from "../lib/pwa/cache-names";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Precached by app/serwist/[path]/route.ts. Shown for a page navigation that
// neither the network nor the page cache can answer: the first launch
// offline, /login offline, or after logout cleared the cached app shell.
const OFFLINE_PAGE_URL = "/~offline";

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

const runtimeCaching: RuntimeCaching[] = [
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
  skipWaiting: true,
});

serwist.addEventListeners();
