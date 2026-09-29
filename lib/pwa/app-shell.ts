// Runs in the service worker (app/sw.ts), apart from the message the page
// sends (lib/pwa/keep-app-shell.ts); it only imports cache names.
//
// Saves the app shell for offline launches once a session's local data is
// ready (cacheAppShell), and keeps it in step with the precache across
// deploys (prepareAppShellRefresh, applyAppShellRefresh).
//
// Activating a new service worker deletes the previous build's precached CSS
// and JS, but a page cached before the deploy still links to them: offline,
// it would load without them and Sell Mode would never start. So while the
// new worker installs, every cached page is fetched again from the new build
// into NEXT_PAGE_CACHE_NAME, and when it activates those pages replace the
// cached ones. If the install fails (a failed or refused fetch here, or in
// the precache), nothing changed: the current worker, its precache and the
// cached pages still match, and the browser retries the update later.

import { NEXT_PAGE_CACHE_NAME, PAGE_CACHE_NAME } from "./cache-names";

type ShellCacheStorage = Pick<CacheStorage, "delete" | "has" | "open">;

// A fresh page from the network with the session's cookies. A redirect is
// returned as it is (opaqueredirect), never followed into /login's page.
const pageFetchInit: RequestInit = {
  cache: "reload",
  credentials: "same-origin",
  redirect: "manual",
};

/** What the page posts to the service worker to save the app shell. */
export const CACHE_APP_SHELL_MESSAGE = {
  type: "GLITTER_POS_CACHE_APP_SHELL",
} as const;

export function isCacheAppShellMessage(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === CACHE_APP_SHELL_MESSAGE.type
  );
}

/**
 * What a new build's response means for a cached page:
 * - "store": a complete page, which replaces the cached one;
 * - "drop": 404 or 410, the page no longer exists, so it is removed;
 * - "retry": anything else, which fails the install and keeps the cached
 *   page. That includes a redirect: "/" redirects to /login whenever the
 *   server cannot confirm the session, which an Auth outage or rate limit
 *   causes as well as a lapsed session, and a transient refusal such as 408
 *   or 429. Neither says the cached page is wrong, and dropping it would
 *   leave an offline launch without Sell Mode. Logout deletes the page cache
 *   itself (clearUserDataCaches).
 */
export function shellRefreshOutcome(
  response: Pick<Response, "status" | "type">
): "store" | "drop" | "retry" {
  if (response.type !== "basic") return "retry";
  if (response.status === 200) return "store";
  if (response.status === 404 || response.status === 410) return "drop";
  return "retry";
}

/**
 * For the page's CACHE_APP_SHELL_MESSAGE, sent once the local data is ready
 * for the signed-in identity: saves the app shell (`url`, "/") when the page
 * cache holds none. The page rule only stores "/" on a document navigation,
 * and after a sign-in or a tenant change there is none left to serve an
 * offline launch: a password sign-in reaches "/" through a client-side
 * navigation, and the teardown that clears a new identity's local data
 * deletes the copy stored while the page loaded.
 *
 * The page creates PAGE_CACHE_NAME before it asks, and every teardown
 * deletes it. So without the cache the session ended and nothing is
 * fetched, and a page fetched while a teardown ran is never kept.
 */
export async function cacheAppShell(input: {
  caches: ShellCacheStorage;
  fetch: typeof fetch;
  url: string;
}): Promise<void> {
  if (!(await input.caches.has(PAGE_CACHE_NAME))) return;
  // Opened before the fetch: if a teardown deletes the cache meanwhile, this
  // one is no longer the cache launches read, even once a later navigation
  // creates PAGE_CACHE_NAME again.
  const pages = await input.caches.open(PAGE_CACHE_NAME);
  const request = new Request(input.url);
  // The same match as the page rule's, so "/?from=pwa" counts as "/". Once a
  // shell is saved, asking again costs no server render.
  if (await pages.match(request, { ignoreSearch: true, ignoreVary: true })) {
    return;
  }

  const response = await input.fetch(input.url, pageFetchInit);
  // Anything but a complete page (a redirect to /login, an error) would not
  // start offline.
  if (shellRefreshOutcome(response) !== "store") return;
  if (!(await input.caches.has(PAGE_CACHE_NAME))) return;
  await pages.put(request, response);
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
      const response = await input.fetch(request.url, pageFetchInit);
      const outcome = shellRefreshOutcome(response);
      if (outcome === "retry") {
        throw new Error(
          `Could not refresh the cached page ${request.url} (${response.type} ${response.status}).`
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
