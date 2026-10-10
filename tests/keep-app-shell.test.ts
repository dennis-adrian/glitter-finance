import assert from "node:assert/strict";
import test from "node:test";
import { CACHE_APP_SHELL_MESSAGE } from "@/lib/pwa/app-shell";
import { PAGE_CACHE_NAME } from "@/lib/pwa/cache-names";
import {
  keepAppShellForOfflineLaunch,
  type AppShellBrowser,
} from "@/lib/pwa/keep-app-shell";

class FakeEvents {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function fakeBrowser(options: { online?: boolean } = {}) {
  const log: string[] = [];
  const posted: unknown[] = [];
  const window = new FakeEvents();
  const serviceWorker = Object.assign(new FakeEvents(), {
    ready: Promise.resolve({
      active: { postMessage: (message: unknown) => posted.push(message) },
    }),
  });
  let online = options.online ?? true;
  const browser = {
    caches: {
      open: async (name: string) => {
        log.push(`open ${name}`);
        return {};
      },
    },
    serviceWorker,
    window,
    isOnline: () => online,
  } as unknown as AppShellBrowser;
  return {
    browser,
    window,
    serviceWorker,
    log,
    posted,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

// Lets the cache open and serviceWorker.ready settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("creates the page cache, then asks the worker to save the shell", async () => {
  const fake = fakeBrowser();

  const stop = keepAppShellForOfflineLaunch(fake.browser);
  await settle();

  assert.deepEqual(fake.log, [`open ${PAGE_CACHE_NAME}`]);
  assert.deepEqual(fake.posted, [CACHE_APP_SHELL_MESSAGE]);
  stop();
});

test("asks again when back online or a new worker takes over, without creating the cache again", async () => {
  const fake = fakeBrowser({ online: false });

  const stop = keepAppShellForOfflineLaunch(fake.browser);
  await settle();
  assert.deepEqual(fake.posted, []);

  fake.setOnline(true);
  fake.window.dispatch("online");
  fake.serviceWorker.dispatch("controllerchange");
  await settle();

  assert.deepEqual(fake.posted, [
    CACHE_APP_SHELL_MESSAGE,
    CACHE_APP_SHELL_MESSAGE,
  ]);
  // A teardown deletes the cache; only the first request may create it.
  assert.deepEqual(fake.log, [`open ${PAGE_CACHE_NAME}`]);
  stop();
});

test("stops asking once the app unmounts", async () => {
  const fake = fakeBrowser();

  const stop = keepAppShellForOfflineLaunch(fake.browser);
  stop();
  await settle();
  fake.window.dispatch("online");
  fake.serviceWorker.dispatch("controllerchange");
  await settle();

  assert.deepEqual(fake.posted, []);
  assert.equal(fake.window.count("online"), 0);
  assert.equal(fake.serviceWorker.count("controllerchange"), 0);
});

test("does nothing where the browser has no service worker", () => {
  const stop = keepAppShellForOfflineLaunch(null);
  assert.doesNotThrow(stop);
});
