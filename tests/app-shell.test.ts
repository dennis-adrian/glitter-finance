import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAppShellRefresh,
  CACHE_APP_SHELL_MESSAGE,
  cacheAppShell,
  isCacheAppShellMessage,
  prepareAppShellRefresh,
  shellRefreshOutcome,
} from "@/lib/pwa/app-shell";
import { NEXT_PAGE_CACHE_NAME, PAGE_CACHE_NAME } from "@/lib/pwa/cache-names";

type FakeResponse = { status: number; type: ResponseType; body: string };

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async match(request: Request, options?: CacheQueryOptions) {
    const withoutSearch = (url: string) => url.split("?")[0];
    const url = options?.ignoreSearch
      ? [...this.entries.keys()].find(
          (key) => withoutSearch(key) === withoutSearch(request.url)
        )
      : request.url;
    return (url === undefined
      ? undefined
      : this.entries.get(url)) as unknown as Response | undefined;
  }

  async put(request: Request, response: Response) {
    this.entries.set(request.url, response as unknown as FakeResponse);
  }

  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  async has(name: string) {
    return this.caches.has(name);
  }

  async open(name: string) {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache as unknown as Cache;
  }

  async delete(name: string) {
    return this.caches.delete(name);
  }

  pages(name = PAGE_CACHE_NAME) {
    const cache = this.caches.get(name);
    return cache
      ? Object.fromEntries(
          [...cache.entries].map(([url, response]) => [url, response.body])
        )
      : null;
  }
}

const home = "https://pos.example/";
const homeWithQuery = "https://pos.example/?from=pwa";

function page(body: string): FakeResponse {
  return { status: 200, type: "basic", body };
}

function storageWithPages(pages: Record<string, string>) {
  const storage = new FakeCacheStorage();
  const cache = new FakeCache();
  for (const [url, body] of Object.entries(pages)) {
    cache.entries.set(url, page(body));
  }
  storage.caches.set(PAGE_CACHE_NAME, cache);
  return storage;
}

function fetchFrom(responses: Record<string, FakeResponse | Error>) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const response = responses[url];
    if (!response || response instanceof Error) {
      throw response ?? new TypeError("Failed to fetch");
    }
    return response as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

function install(storage: FakeCacheStorage, fetch: typeof globalThis.fetch) {
  return prepareAppShellRefresh({
    caches: storage as unknown as CacheStorage,
    fetch,
  });
}

function activate(storage: FakeCacheStorage) {
  return applyAppShellRefresh({ caches: storage as unknown as CacheStorage });
}

test("classifies a new build's response for a cached page", () => {
  assert.equal(shellRefreshOutcome({ status: 200, type: "basic" }), "store");
  // Only a page that no longer exists is dropped.
  for (const status of [404, 410]) {
    assert.equal(shellRefreshOutcome({ status, type: "basic" }), "drop");
  }
  // A redirect to /login also follows an Auth outage or rate limit, not only
  // a lapsed session; 408 and 429 are transient; 5xx is a server error.
  assert.equal(
    shellRefreshOutcome({ status: 0, type: "opaqueredirect" }),
    "retry"
  );
  for (const status of [307, 400, 401, 403, 408, 429, 500, 503]) {
    assert.equal(shellRefreshOutcome({ status, type: "basic" }), "retry");
  }
  assert.equal(shellRefreshOutcome({ status: 0, type: "error" }), "retry");
});

test("a new build's pages replace the cached ones when it activates", async () => {
  const storage = storageWithPages({ [home]: "old build" });
  const { fetch, requests } = fetchFrom({ [home]: page("new build") });

  await install(storage, fetch);

  // The current worker keeps serving the old build until activation.
  assert.deepEqual(storage.pages(), { [home]: "old build" });
  assert.deepEqual(storage.pages(NEXT_PAGE_CACHE_NAME), {
    [home]: "new build",
  });
  assert.deepEqual(requests[0].init, {
    cache: "reload",
    credentials: "same-origin",
    redirect: "manual",
  });

  await activate(storage);

  assert.deepEqual(storage.pages(), { [home]: "new build" });
  assert.equal(storage.pages(NEXT_PAGE_CACHE_NAME), null);
});

test("a page that no longer exists is dropped instead of kept stale", async () => {
  for (const status of [404, 410]) {
    const storage = storageWithPages({
      [home]: "old build",
      [homeWithQuery]: "old build",
    });
    const { fetch } = fetchFrom({
      [home]: { status, type: "basic", body: "" },
      [homeWithQuery]: page("new build"),
    });

    await install(storage, fetch);
    await activate(storage);

    assert.deepEqual(storage.pages(), { [homeWithQuery]: "new build" });
  }
});

test("a failed, refused or redirected refresh fails the install and changes nothing", async () => {
  for (const failure of [
    new TypeError("Failed to fetch"),
    { status: 502, type: "basic" as const, body: "" },
    { status: 408, type: "basic" as const, body: "" },
    { status: 429, type: "basic" as const, body: "" },
    // "/" -> /login: the server could not confirm the session, which an
    // Auth outage causes as well as a lapsed session.
    { status: 0, type: "opaqueredirect" as const, body: "" },
  ]) {
    const storage = storageWithPages({
      [home]: "old build",
      [homeWithQuery]: "old build",
    });
    const { fetch } = fetchFrom({
      [home]: page("new build"),
      [homeWithQuery]: failure,
    });

    await assert.rejects(install(storage, fetch));

    assert.deepEqual(storage.pages(), {
      [home]: "old build",
      [homeWithQuery]: "old build",
    });
    assert.equal(storage.pages(NEXT_PAGE_CACHE_NAME), null);
  }
});

test("nothing is cached for a device without a saved app shell", async () => {
  const storage = new FakeCacheStorage();
  const { fetch, requests } = fetchFrom({});

  await install(storage, fetch);
  await activate(storage);

  assert.equal(requests.length, 0);
  assert.equal(storage.pages(), null);
  assert.equal(storage.pages(NEXT_PAGE_CACHE_NAME), null);
});

test("a logout during the update never brings the old session's page back", async () => {
  // Logout while the pages are being fetched.
  const duringFetch = storageWithPages({ [home]: "old build" });
  await install(duringFetch, (async () => {
    await duringFetch.delete(PAGE_CACHE_NAME);
    return page("signed-in page") as unknown as Response;
  }) as typeof fetch);
  await activate(duringFetch);
  assert.equal(duringFetch.pages(), null);
  assert.equal(duringFetch.pages(NEXT_PAGE_CACHE_NAME), null);

  // Logout between install and activation deleted the page cache: the
  // refreshed pages are discarded, not restored.
  const beforeActivation = storageWithPages({ [home]: "old build" });
  await install(beforeActivation, fetchFrom({ [home]: page("new") }).fetch);
  await beforeActivation.delete(PAGE_CACHE_NAME);
  await activate(beforeActivation);
  assert.equal(beforeActivation.pages(), null);
  assert.equal(beforeActivation.pages(NEXT_PAGE_CACHE_NAME), null);
});

function saveShell(storage: FakeCacheStorage, fetch: typeof globalThis.fetch) {
  return cacheAppShell({
    caches: storage as unknown as CacheStorage,
    fetch,
    url: home,
  });
}

/** The page cache as the signed-in app leaves it before asking: empty. */
function storageForSignedInApp() {
  const storage = new FakeCacheStorage();
  storage.caches.set(PAGE_CACHE_NAME, new FakeCache());
  return storage;
}

test("recognizes the page's request to save the app shell", () => {
  assert.equal(isCacheAppShellMessage(CACHE_APP_SHELL_MESSAGE), true);
  assert.equal(isCacheAppShellMessage({ ...CACHE_APP_SHELL_MESSAGE }), true);
  for (const other of [
    null,
    undefined,
    "GLITTER_POS_CACHE_APP_SHELL",
    { type: "CACHE_URLS" },
    { type: "SKIP_WAITING" },
  ]) {
    assert.equal(isCacheAppShellMessage(other), false);
  }
});

test("saves the app shell after a sign-in or tenant change left none", async () => {
  const storage = storageForSignedInApp();
  const { fetch, requests } = fetchFrom({ [home]: page("signed-in shell") });

  await saveShell(storage, fetch);

  assert.deepEqual(storage.pages(), { [home]: "signed-in shell" });
  assert.deepEqual(requests, [
    {
      url: home,
      init: { cache: "reload", credentials: "same-origin", redirect: "manual" },
    },
  ]);
});

test("a saved shell is kept without another server render", async () => {
  for (const saved of [home, homeWithQuery]) {
    const storage = storageWithPages({ [saved]: "navigation's copy" });
    const { fetch, requests } = fetchFrom({ [home]: page("again") });

    await saveShell(storage, fetch);

    assert.equal(requests.length, 0);
    assert.deepEqual(storage.pages(), { [saved]: "navigation's copy" });
  }
});

test("nothing is saved once a teardown deleted the page cache", async () => {
  const storage = new FakeCacheStorage();
  const { fetch, requests } = fetchFrom({ [home]: page("signed-in shell") });

  await saveShell(storage, fetch);

  assert.equal(requests.length, 0);
  assert.equal(storage.pages(), null);
});

test("only a complete page is saved as the app shell", async () => {
  for (const response of [
    { status: 0, type: "opaqueredirect" as const, body: "" },
    { status: 404, type: "basic" as const, body: "" },
    { status: 429, type: "basic" as const, body: "" },
    { status: 503, type: "basic" as const, body: "" },
  ]) {
    const storage = storageForSignedInApp();
    await saveShell(storage, fetchFrom({ [home]: response }).fetch);
    assert.deepEqual(storage.pages(), {});
  }

  const offline = storageForSignedInApp();
  await assert.rejects(saveShell(offline, fetchFrom({}).fetch));
  assert.deepEqual(offline.pages(), {});
});

test("a teardown while the shell is fetched keeps the ended session's page out", async () => {
  // Logout: the page cache is gone.
  const loggedOut = storageForSignedInApp();
  await saveShell(loggedOut, (async () => {
    await loggedOut.delete(PAGE_CACHE_NAME);
    return page("previous session") as unknown as Response;
  }) as typeof fetch);
  assert.equal(loggedOut.pages(), null);

  // Tenant change: the next identity's navigation already created the page
  // cache again, and only its own page may appear in it.
  const switched = storageForSignedInApp();
  await saveShell(switched, (async () => {
    await switched.delete(PAGE_CACHE_NAME);
    await switched.open(PAGE_CACHE_NAME);
    return page("previous tenant") as unknown as Response;
  }) as typeof fetch);
  assert.deepEqual(switched.pages(), {});
});
