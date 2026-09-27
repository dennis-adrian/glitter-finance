import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";
import { changeIdentityAfterLocalTeardown } from "@/lib/auth/identity-change";
import {
  reportPermanentSyncFailure,
  resetReportedSyncFailures,
} from "@/lib/observability/report-sync-failure";
import {
  clearUserDataCaches,
  isUnsyncedLocalDataRefusal,
  localDataIdentityMatches,
  onLocalDataEvent,
  readLocalDataIdentity,
  readUnsyncedLocalWork,
  saveLocalDataIdentity,
  teardownLocalUserData,
} from "@/lib/powersync/local-data-teardown";
import { TenantWorkController } from "@/lib/powersync/tenant-work";
import { usePosStore } from "@/lib/store";
import type { Product, Sale } from "@/lib/types";

function signOutAfterLocalTeardown(
  teardown: () => Promise<void>,
  serverSignOut: () => Promise<void>
) {
  return changeIdentityAfterLocalTeardown({
    teardown,
    commit: serverSignOut,
    destination: "/login",
    failureMessage: "No se pudo cerrar la sesión.",
    reportFailure: (message) => {
      throw new Error(`Unexpected server failure: ${message}`);
    },
    navigate: () => {},
  });
}

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
    getUploadQueueStats: async () => ({ count: 0 }),
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
      getUploadQueueStats: async () => {
        events.push("check-upload-queue");
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
          refuseWhenUnsynced: true,
          onDestructiveStart: () => events.push("destructive-start"),
          cacheStorage,
        }),
      async () => {
        events.push("server-sign-out");
      }
    );

    assert.deepEqual(events, [
      "check-sync-failures",
      "check-upload-queue",
      "destructive-start",
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

test("teardown deletes every cache except the build-asset caches", async () => {
  const cacheNames = new Set([
    // App caches that hold a user's data.
    "glitter-pos-pages",
    "glitter-pos-pages-next",
    "glitter-pos-product-images",
    // Serwist defaultCache names, e.g. the old cacheOnNavigation copy of "/".
    "others",
    "pages",
    "pages-rsc",
    "pages-rsc-prefetch",
    "apis",
    "cross-origin",
    // Build assets the app needs to start offline.
    "glitter-pos-precache-v2-https://pos.example/",
    "glitter-pos-static",
    "glitter-pos-static-powersync",
  ]);

  await clearUserDataCaches({
    keys: async () => [...cacheNames],
    delete: async (name: string) => cacheNames.delete(name),
  });

  assert.deepEqual(
    [...cacheNames],
    [
      "glitter-pos-precache-v2-https://pos.example/",
      "glitter-pos-static",
      "glitter-pos-static-powersync",
    ]
  );
});

function refusalProbe(input: { pendingUploads: number; failures: number }) {
  const events: string[] = [];
  const db = {
    ...emptySyncFailureState(),
    getOptional: async () => ({ count: input.failures }),
    getUploadQueueStats: async () => ({ count: input.pendingUploads }),
    disconnectAndClear: async () => {
      events.push("clear-powersync");
    },
  } as unknown as AbstractPowerSyncDatabase;
  const cacheStorage = {
    keys: async () => ["glitter-pos-pages"],
    delete: async (name: string) => {
      events.push(`clear-cache:${name}`);
      return true;
    },
  };
  for (const event of ["teardown-starting", "teardown-failed", "cleared"]) {
    window.addEventListener(`glitter-pos-local-data-${event}`, () => {
      events.push(event);
    });
  }
  return { db, cacheStorage, events };
}

test("teardown refuses before any destructive step while uploads are pending", async () => {
  await withBrowser(async (storage) => {
    const { db, cacheStorage, events } = refusalProbe({
      pendingUploads: 2,
      failures: 0,
    });
    let serverSignOutCalled = false;
    saveLocalDataIdentity({ userId: "user-a", tenantId: "tenant-a" });
    usePosStore.setState({ sales: [{} as Sale] });

    await assert.rejects(
      signOutAfterLocalTeardown(
        () =>
          teardownLocalUserData({
            db,
            powerSyncRequired: true,
            refuseWhenUnsynced: true,
            onDestructiveStart: () => events.push("destructive-start"),
            cacheStorage,
          }),
        async () => {
          serverSignOutCalled = true;
        }
      ),
      (error: unknown) => {
        assert.ok(isUnsyncedLocalDataRefusal(error));
        assert.equal(error.stage, "pending-uploads");
        assert.match(error.message, /Hay 2 operaciones sin subir a la nube/);
        return true;
      }
    );

    assert.deepEqual(events, []);
    assert.equal(serverSignOutCalled, false);
    assert.notEqual(
      storage.getItem("glitter-pos-local-data-identity-v1"),
      null
    );
    assert.equal(usePosStore.getState().sales.length, 1);
  });
});

test("teardown refuses while unresolved sync failures exist", async () => {
  await withBrowser(async () => {
    const { db, cacheStorage, events } = refusalProbe({
      pendingUploads: 1,
      failures: 1,
    });

    await assert.rejects(
      teardownLocalUserData({
        db,
        powerSyncRequired: true,
        refuseWhenUnsynced: true,
        cacheStorage,
      }),
      (error: unknown) => {
        assert.ok(isUnsyncedLocalDataRefusal(error));
        assert.equal(error.stage, "sync-failures");
        return true;
      }
    );
    assert.deepEqual(events, []);
  });
});

test("teardown fails closed when the upload queue cannot be read", async () => {
  await withBrowser(async () => {
    const { db, cacheStorage, events } = refusalProbe({
      pendingUploads: 0,
      failures: 0,
    });
    db.getUploadQueueStats = async () => {
      throw new Error("queue unavailable");
    };

    await assert.rejects(
      teardownLocalUserData({
        db,
        powerSyncRequired: true,
        refuseWhenUnsynced: true,
        cacheStorage,
      }),
      (error: unknown) => isUnsyncedLocalDataRefusal(error)
    );
    assert.deepEqual(events, []);
  });
});

test("readUnsyncedLocalWork counts queued uploads and failure markers", async () => {
  await withBrowser(async () => {
    const { db } = refusalProbe({ pendingUploads: 3, failures: 1 });
    assert.deepEqual(await readUnsyncedLocalWork(db), {
      pendingUploadCount: 3,
      unresolvedFailureCount: 1,
    });
  });
});

test("the identity marker keeps the account email for display only", async () => {
  await withBrowser(async (storage) => {
    saveLocalDataIdentity({
      userId: "user-a",
      tenantId: "tenant-a",
      email: "ana@example.com",
    });
    const stored = readLocalDataIdentity();
    assert.deepEqual(stored, {
      userId: "user-a",
      tenantId: "tenant-a",
      email: "ana@example.com",
    });
    assert.equal(
      localDataIdentityMatches(stored, {
        userId: "user-a",
        tenantId: "tenant-a",
      }),
      true
    );

    // Markers written before the email existed still parse.
    storage.setItem(
      "glitter-pos-local-data-identity-v1",
      JSON.stringify({ userId: "user-a", tenantId: null })
    );
    assert.deepEqual(readLocalDataIdentity(), {
      userId: "user-a",
      tenantId: null,
      email: null,
    });
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
      refuseWhenUnsynced: false,
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
            refuseWhenUnsynced: true,
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

    const stopTenantWork = onLocalDataEvent("teardown-starting", () =>
      tenantWork.cancel()
    );
    const resumeTenantWork = onLocalDataEvent("teardown-failed", () =>
      tenantWork.resumeAfterFailedTeardown()
    );
    const observeCleared = onLocalDataEvent("cleared", () => {
      events.push("clear-memory");
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
              refuseWhenUnsynced: true,
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

      assert.deepEqual(events, ["clear-powersync", "clear-memory"]);
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
    }
  });
});

test("teardown succeeds when Cache Storage is unsupported", async () => {
  await withBrowser(async () => {
    await teardownLocalUserData({
      db: null,
      powerSyncRequired: false,
      refuseWhenUnsynced: false,
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
    const stopTenantWork = onLocalDataEvent("teardown-starting", () =>
      tenantWork.cancel()
    );
    const keepTenantWorkStopped = onLocalDataEvent("cleared", () =>
      tenantWork.cancel()
    );

    try {
      await teardownLocalUserData({
        db: null,
        powerSyncRequired: false,
        refuseWhenUnsynced: false,
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
    const stopTenantWork = onLocalDataEvent("teardown-starting", () =>
      tenantWork.cancel()
    );
    const resumeTenantWork = onLocalDataEvent("teardown-failed", () =>
      tenantWork.resumeAfterFailedTeardown()
    );

    try {
      await assert.rejects(
        teardownLocalUserData({
          db: null,
          powerSyncRequired: false,
          refuseWhenUnsynced: false,
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
            refuseWhenUnsynced: true,
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
