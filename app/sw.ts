/// <reference lib="webworker" />

import { defaultCache } from "@serwist/turbopack/worker";
import {
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
  {
    matcher: ({ request, sameOrigin, url }) =>
      sameOrigin &&
      request.mode === "navigate" &&
      !isIdentitySensitivePath(url.pathname),
    handler: new NetworkFirst({
      cacheName: "glitter-pos-pages",
      networkTimeoutSeconds: 3,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 16,
          maxAgeSeconds: 7 * 24 * 60 * 60,
        }),
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
      cacheName: "glitter-pos-static",
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
  cacheId: "glitter-pos",
  clientsClaim: true,
  navigationPreload: true,
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    navigateFallback: "/~offline",
    navigateFallbackDenylist: [
      /^\/api\//,
      /^\/auth(?:\/|$)/,
      /^\/login(?:\/|$)/,
      /^\/join(?:\/|$)/,
      /^\/serwist\//,
    ],
  },
  runtimeCaching,
  skipWaiting: true,
});

serwist.addEventListeners();
