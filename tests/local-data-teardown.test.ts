import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { signOutAfterLocalTeardown } from "@/lib/auth/client-logout";
import {
  readLocalDataIdentity,
  saveLocalDataIdentity,
  teardownLocalUserData,
} from "@/lib/powersync/local-data-teardown";
import { usePosStore } from "@/lib/store";
import type { Product, Sale } from "@/lib/types";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

async function withBrowser<T>(
  callback: (storage: MemoryStorage) => Promise<T>
) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });

  try {
    return await callback(storage);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

test("teardown purges local user data before calling server sign-out", async () => {
  await withBrowser(async (storage) => {
    const events: string[] = [];
    const deletedCaches: string[] = [];
    const cacheNames = new Set([
      "glitter-pos-pages",
      "glitter-pos-api-v1",
      "glitter-pos-static",
      "glitter-pos-precache-v2",
    ]);
    const db = {
      getOptional: async () => {
        events.push("check-sync-failures");
        return { count: 0 };
      },
      disconnectAndClear: async () => {
        events.push("clear-powersync");
      },
    } as unknown as AbstractPowerSyncDatabase;
    window.addEventListener("glitter-pos-local-data-teardown-starting", () => {
      events.push("teardown-started");
    });
    const cacheStorage = {
      keys: async () => [...cacheNames],
      delete: async (name: string) => {
        deletedCaches.push(name);
        events.push(`clear-cache:${name}`);
        cacheNames.delete(name);
        // CacheStorage.delete() may report false despite concurrent removal.
        return name !== "glitter-pos-pages";
      },
    };

    storage.setItem("glitter-pos-initial-sync-completed-v1", "true");
    storage.setItem("glitter-pos-draft-cart-migrated-v1", "2026-08-09");
    storage.setItem("glitter-pos-local-v1", "legacy-cart");
    saveLocalDataIdentity({ userId: "user-a", tenantId: "tenant-a" });
    usePosStore.setState({
      products: [{} as Product],
      cart: [{ productId: "product-a", quantity: 1 }],
      sales: [{} as Sale],
    });

    await signOutAfterLocalTeardown(
      () =>
        teardownLocalUserData({
          db,
          powerSyncRequired: true,
          refuseWhenSyncFailuresExist: true,
          cacheStorage,
        }),
      async () => {
        events.push("server-sign-out");
      }
    );

    assert.deepEqual(events, [
      "check-sync-failures",
      "teardown-started",
      "clear-cache:glitter-pos-pages",
      "clear-cache:glitter-pos-api-v1",
      "clear-powersync",
      "server-sign-out",
    ]);
    assert.deepEqual(deletedCaches, [
      "glitter-pos-pages",
      "glitter-pos-api-v1",
    ]);
    assert.equal(
      storage.getItem("glitter-pos-initial-sync-completed-v1"),
      null
    );
    assert.equal(storage.getItem("glitter-pos-draft-cart-migrated-v1"), null);
    assert.equal(storage.getItem("glitter-pos-local-v1"), null);
    assert.equal(readLocalDataIdentity(), null);
    assert.deepEqual(usePosStore.getState().products, []);
    assert.deepEqual(usePosStore.getState().cart, []);
    assert.deepEqual(usePosStore.getState().sales, []);
  });
});

test("a teardown failure prevents server sign-out", async () => {
  await withBrowser(async () => {
    let serverSignOutCalled = false;
    const db = {
      getOptional: async () => ({ count: 0 }),
      disconnectAndClear: async () => {
        throw new Error("database clear failed");
      },
    } as unknown as AbstractPowerSyncDatabase;

    await assert.rejects(
      signOutAfterLocalTeardown(
        () =>
          teardownLocalUserData({
            db,
            powerSyncRequired: true,
            refuseWhenSyncFailuresExist: true,
            cacheStorage: {
              keys: async () => [],
              delete: async () => true,
            },
          }),
        async () => {
          serverSignOutCalled = true;
        }
      ),
      /No se pudo borrar la base local/
    );

    assert.equal(serverSignOutCalled, false);
  });
});

test("a cache deletion failure prevents database clearing and server sign-out", async () => {
  await withBrowser(async () => {
    let databaseCleared = false;
    let serverSignOutCalled = false;
    const db = {
      getOptional: async () => ({ count: 0 }),
      disconnectAndClear: async () => {
        databaseCleared = true;
      },
    } as unknown as AbstractPowerSyncDatabase;

    await assert.rejects(
      signOutAfterLocalTeardown(
        () =>
          teardownLocalUserData({
            db,
            powerSyncRequired: true,
            refuseWhenSyncFailuresExist: true,
            cacheStorage: {
              // The entry remains after deletion, so teardown must fail even
              // though CacheStorage.delete() alone is not authoritative.
              keys: async () => ["glitter-pos-pages"],
              delete: async () => false,
            },
          }),
        async () => {
          serverSignOutCalled = true;
        }
      ),
      /No se pudieron borrar los datos almacenados/
    );

    assert.equal(databaseCleared, false);
    assert.equal(serverSignOutCalled, false);
  });
});
