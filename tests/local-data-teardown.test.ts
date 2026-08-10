import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";
import { signOutAfterLocalTeardown } from "@/lib/auth/client-logout";
import {
  reportPermanentSyncFailure,
  resetReportedSyncFailures,
} from "@/lib/observability/report-sync-failure";
import {
  onLocalDataCleared,
  onLocalDataTeardownFailed,
  onLocalDataTeardownStarting,
  onLocalDataTeardownTerminal,
  readLocalDataIdentity,
  saveLocalDataIdentity,
  teardownLocalUserData,
} from "@/lib/powersync/local-data-teardown";
import { TenantWorkController } from "@/lib/powersync/tenant-work";
import { usePosStore } from "@/lib/store";
import type { Product, Sale } from "@/lib/types";

class MemoryStorage {
  private values = new Map<string, string>();
  private failedRemovalKey: string | null = null;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    if (key === this.failedRemovalKey) {
      throw new Error(`Failed to remove ${key}`);
    }
    this.values.delete(key);
  }

  failRemovalFor(key: string) {
    this.failedRemovalKey = key;
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

function emptySyncFailureState() {
  return {
    getAll: async () => [],
    getCrudTransactions: async function* () {},
  };
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
      ...emptySyncFailureState(),
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

test("teardown resets sync failure reporting after queue cleanup", async () => {
  await withBrowser(async () => {
    const input = {
      error: { code: "23514" },
      transactionId: 1,
      operations: [
        {
          clientId: 1,
          opData: { tenant_id: "tenant-a" },
        } as unknown as CrudEntry,
      ],
    };
    resetReportedSyncFailures();
    assert.equal(reportPermanentSyncFailure(input), true);
    assert.equal(reportPermanentSyncFailure(input), false);

    await teardownLocalUserData({
      db: null,
      powerSyncRequired: false,
      refuseWhenSyncFailuresExist: false,
      cacheStorage: { keys: async () => [], delete: async () => true },
    });

    assert.equal(reportPermanentSyncFailure(input), true);
  });
});

test("a teardown failure prevents server sign-out", async () => {
  await withBrowser(async () => {
    let teardownFailed = false;
    let serverSignOutCalled = false;
    const db = {
      ...emptySyncFailureState(),
      getOptional: async () => ({ count: 0 }),
      disconnectAndClear: async () => {
        throw new Error("database clear failed");
      },
    } as unknown as AbstractPowerSyncDatabase;
    window.addEventListener("glitter-pos-local-data-teardown-failed", () => {
      teardownFailed = true;
    });

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

    assert.equal(teardownFailed, true);
    assert.equal(serverSignOutCalled, false);
  });
});

test("a post-destructive failure clears memory and prevents server sign-out", async () => {
  await withBrowser(async (storage) => {
    const events: string[] = [];
    let serverSignOutCalled = false;
    const identity = { userId: "user-a", tenantId: "tenant-a" };
    const tenantWork = new TenantWorkController(identity);
    const staleWork = tenantWork.begin();
    const db = {
      ...emptySyncFailureState(),
      getOptional: async () => ({ count: 0 }),
      disconnectAndClear: async () => {
        events.push("clear-powersync");
      },
    } as unknown as AbstractPowerSyncDatabase;

    const stopTenantWork = onLocalDataTeardownStarting(() =>
      tenantWork.cancel()
    );
    const resumeTenantWork = onLocalDataTeardownFailed(() =>
      tenantWork.resumeAfterFailedTeardown()
    );
    const observeCleared = onLocalDataCleared(() => {
      events.push("clear-memory");
    });
    const observeTerminal = onLocalDataTeardownTerminal(() => {
      events.push("teardown-terminal");
    });
    saveLocalDataIdentity(identity);
    storage.failRemovalFor("glitter-pos-local-data-identity-v1");
    usePosStore.setState({
      products: [{} as Product],
      cart: [{ productId: "product-a", quantity: 1 }],
      sales: [{} as Sale],
    });

    try {
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
        /No se pudo limpiar el almacenamiento local/
      );

      assert.deepEqual(events, [
        "clear-powersync",
        "clear-memory",
        "teardown-terminal",
      ]);
      assert.equal(staleWork.isCurrent(), false);
      assert.throws(
        () => tenantWork.begin().assertCurrent(),
        /Tenant work was cancelled/
      );
      assert.equal(serverSignOutCalled, false);
      assert.notEqual(
        storage.getItem("glitter-pos-local-data-identity-v1"),
        null
      );
      assert.deepEqual(usePosStore.getState().products, []);
      assert.deepEqual(usePosStore.getState().cart, []);
      assert.deepEqual(usePosStore.getState().sales, []);
    } finally {
      stopTenantWork();
      resumeTenantWork();
      observeCleared();
      observeTerminal();
    }
  });
});

test("teardown succeeds when Cache Storage is unsupported", async () => {
  await withBrowser(async () => {
    await teardownLocalUserData({
      db: null,
      powerSyncRequired: false,
      refuseWhenSyncFailuresExist: false,
    });
  });
});

test("tenant work resumes only after replacement tenant data is ready", async () => {
  await withBrowser(async () => {
    const tenantWork = new TenantWorkController({
      userId: "user-a",
      tenantId: "tenant-a",
    });
    const staleWork = tenantWork.begin();
    const stopTenantWork = onLocalDataTeardownStarting(() =>
      tenantWork.cancel()
    );
    const keepTenantWorkStopped = onLocalDataCleared(() => tenantWork.cancel());

    try {
      await teardownLocalUserData({
        db: null,
        powerSyncRequired: false,
        refuseWhenSyncFailuresExist: false,
        cacheStorage: {
          keys: async () => [],
          delete: async () => true,
        },
      });

      assert.equal(staleWork.isCurrent(), false);
      assert.equal(
        tenantWork.resumeForReadyIdentity({
          userId: "user-a",
          tenantId: "tenant-a",
        }),
        false
      );
      assert.throws(
        () => tenantWork.begin().assertCurrent(),
        /Tenant work was cancelled/
      );

      assert.equal(
        tenantWork.resumeForReadyIdentity({
          userId: "user-a",
          tenantId: "tenant-b",
        }),
        true
      );
      assert.doesNotThrow(() => tenantWork.begin().assertCurrent());
    } finally {
      stopTenantWork();
      keepTenantWorkStopped();
    }
  });
});

test("tenant work resumes for the existing identity after teardown fails", async () => {
  await withBrowser(async () => {
    const identity = { userId: "user-a", tenantId: "tenant-a" };
    const tenantWork = new TenantWorkController(identity);
    const staleWork = tenantWork.begin();
    const stopTenantWork = onLocalDataTeardownStarting(() =>
      tenantWork.cancel()
    );
    const resumeTenantWork = onLocalDataTeardownFailed(() =>
      tenantWork.resumeAfterFailedTeardown()
    );

    try {
      await assert.rejects(
        teardownLocalUserData({
          db: null,
          powerSyncRequired: false,
          refuseWhenSyncFailuresExist: false,
          cacheStorage: {
            keys: async () => ["glitter-pos-pages"],
            delete: async () => false,
          },
        }),
        /No se pudieron borrar los datos almacenados/
      );

      assert.equal(staleWork.isCurrent(), false);
      assert.equal(tenantWork.resumeForReadyIdentity(identity), false);
      assert.doesNotThrow(() => tenantWork.begin().assertCurrent());
    } finally {
      stopTenantWork();
      resumeTenantWork();
    }
  });
});

test("a cache deletion failure prevents database clearing and server sign-out", async () => {
  await withBrowser(async () => {
    let databaseCleared = false;
    let serverSignOutCalled = false;
    let teardownFailed = false;
    const db = {
      ...emptySyncFailureState(),
      getOptional: async () => ({ count: 0 }),
      disconnectAndClear: async () => {
        databaseCleared = true;
      },
    } as unknown as AbstractPowerSyncDatabase;
    window.addEventListener("glitter-pos-local-data-teardown-failed", () => {
      teardownFailed = true;
    });

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
    assert.equal(teardownFailed, true);
    assert.equal(serverSignOutCalled, false);
  });
});
