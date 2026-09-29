"use client";

import { CACHE_APP_SHELL_MESSAGE } from "./app-shell";
import { PAGE_CACHE_NAME } from "./cache-names";

/** The browser APIs keepAppShellForOfflineLaunch uses (tests pass fakes). */
export type AppShellBrowser = {
  caches: Pick<CacheStorage, "open">;
  serviceWorker: Pick<
    ServiceWorkerContainer,
    "ready" | "addEventListener" | "removeEventListener"
  >;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  isOnline: () => boolean;
};

function currentBrowser(): AppShellBrowser | null {
  // No service worker runs in development (SerwistClientProvider), and
  // neither API exists on plain http outside localhost.
  if (
    process.env.NODE_ENV === "development" ||
    typeof window === "undefined" ||
    !("caches" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }
  return {
    caches: window.caches,
    serviceWorker: navigator.serviceWorker,
    window,
    isOnline: () => navigator.onLine,
  };
}

/**
 * Asks the service worker to save the app shell for an offline launch
 * (cacheAppShell in lib/pwa/app-shell.ts): now, whenever the device comes
 * back online, and when a new service worker takes over, since one from an
 * older build ignores the request. The worker does nothing while a shell is
 * saved, so asking again costs no server render.
 *
 * Only for the app shell once its local data is ready for the signed-in
 * identity, that is after the teardown that deleted the previous session's
 * shell. Returns a function that stops asking.
 */
export function keepAppShellForOfflineLaunch(
  browser: AppShellBrowser | null = currentBrowser()
): () => void {
  if (!browser) {
    return () => {};
  }

  let stopped = false;
  const ask = () => {
    if (stopped || !browser.isOnline()) return;
    void browser.serviceWorker.ready.then((registration) => {
      if (!stopped) {
        registration.active?.postMessage(CACHE_APP_SHELL_MESSAGE);
      }
    });
  };

  // The worker only saves into an existing page cache, and every teardown
  // deletes it: this session creates it once, here. Asking again never
  // does, so a request that outlives a logout saves nothing.
  browser.caches.open(PAGE_CACHE_NAME).then(ask, (error: unknown) => {
    console.warn("[pwa] could not prepare the app shell cache", error);
  });
  browser.window.addEventListener("online", ask);
  browser.serviceWorker.addEventListener("controllerchange", ask);

  return () => {
    stopped = true;
    browser.window.removeEventListener("online", ask);
    browser.serviceWorker.removeEventListener("controllerchange", ask);
  };
}
