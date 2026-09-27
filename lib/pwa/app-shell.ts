// Runs in the service worker (app/sw.ts); it only imports cache names.
//
// Keeps the cached app shell in step with the precache across deploys.
// Activating a new service worker deletes the previous build's precached CSS
// and JS, but a page cached before the deploy still links to them: offline,
// it would load without them and Sell Mode would never start. So while the
// new worker installs, every cached page is fetched again from the new build
// into NEXT_PAGE_CACHE_NAME, and when it activates those pages replace the
// cached ones. If the install fails (a network or server error here, or in
// the precache), nothing changed: the current worker, its precache and the
// cached pages still match, and the browser retries the update later.

import { NEXT_PAGE_CACHE_NAME, PAGE_CACHE_NAME } from "./cache-names";

type ShellCacheStorage = Pick<CacheStorage, "delete" | "has" | "open">;

/**
 * What a new build's response means for a cached page:
 * - "store": a complete page, which replaces the cached one;
 * - "drop": a redirect or client error (the session ended, the page is
 *   gone), so the cached page could no longer start and is removed;
 * - "retry": a server error, which fails the install.
 */
export function shellRefreshOutcome(
  response: Pick<Response, "status" | "type">
): "store" | "drop" | "retry" {
  if (response.type === "basic" && response.status === 200) return "store";
  if (
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 500)
  ) {
    return "drop";
  }
  return "retry";
}

/** For the install event. Rejects, failing the install, on any error. */
export async function prepareAppShellRefresh(input: {
  caches: ShellCacheStorage;
  fetch: typeof fetch;
}): Promise<void> {
  await input.caches.delete(NEXT_PAGE_CACHE_NAME);
  // caches.open() would create the cache, e.g. right after logout deleted it.
  if (!(await input.caches.has(PAGE_CACHE_NAME))) return;
  const pages = await input.caches.open(PAGE_CACHE_NAME);

  const refreshed = await Promise.all(
    (await pages.keys()).map(async (request) => {
      const response = await input.fetch(request.url, {
        cache: "reload",
        credentials: "same-origin",
        redirect: "manual",
      });
      const outcome = shellRefreshOutcome(response);
      if (outcome === "retry") {
        throw new Error(
          `Could not refresh the cached page ${request.url} (${response.status}).`
        );
      }
      return { request, response, outcome };
    })
  );

  // A logout while the pages were fetched deleted the cache: never keep the
  // previous session's pages.
  if (!(await input.caches.has(PAGE_CACHE_NAME))) return;
  const next = await input.caches.open(NEXT_PAGE_CACHE_NAME);
  for (const { request, response, outcome } of refreshed) {
    if (outcome === "store") {
      await next.put(request, response);
    }
  }
}

/** For the activate event: the refreshed pages replace the cached ones. */
export async function applyAppShellRefresh(input: {
  caches: ShellCacheStorage;
}): Promise<void> {
  if (!(await input.caches.has(NEXT_PAGE_CACHE_NAME))) return;
  const next = await input.caches.open(NEXT_PAGE_CACHE_NAME);
  if (await input.caches.has(PAGE_CACHE_NAME)) {
    const pages = await input.caches.open(PAGE_CACHE_NAME);
    const nextRequests = await next.keys();
    const nextUrls = new Set(nextRequests.map((request) => request.url));
    for (const request of await pages.keys()) {
      if (!nextUrls.has(request.url)) {
        await pages.delete(request);
      }
    }
    for (const request of nextRequests) {
      const response = await next.match(request);
      if (response) {
        await pages.put(request, response);
      }
    }
  }
  await input.caches.delete(NEXT_PAGE_CACHE_NAME);
}
