import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { migrateLegacyDraftCartLocal } from "@/lib/powersync/draft-cart";

const legacyKey = "glitter-pos-local-v1";
const markerKey = "glitter-pos-draft-cart-migrated-v1";

class MemoryStorage {
  readonly values = new Map<string, string>();
  reads = 0;
  failReads = false;

  getItem(key: string) {
    this.reads += 1;
    if (this.failReads) throw new Error("Storage is blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

async function withWindow<T>(
  windowValue: object,
  callback: () => Promise<T>
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowValue,
  });
  try {
    return await callback();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "window", original);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
}

function recordingDb(writes: string[]) {
  return {
    execute: async (sql: string) => {
      writes.push(sql);
    },
  } as unknown as AbstractPowerSyncDatabase;
}

test("moves a fresh legacy draft cart once and clears the legacy key", async () => {
  const storage = new MemoryStorage();
  storage.setItem(
    legacyKey,
    JSON.stringify({
      state: {
        cart: [{ productId: "product-1", quantity: 2 }],
        cartUpdatedAt: new Date().toISOString(),
      },
    })
  );
  const writes: string[] = [];

  await withWindow({ localStorage: storage }, async () => {
    await migrateLegacyDraftCartLocal(recordingDb(writes));
    await migrateLegacyDraftCartLocal(recordingDb(writes));
  });

  assert.equal(writes.length, 1);
  assert.match(writes[0], /INSERT OR REPLACE INTO draft_cart/);
  assert.equal(storage.values.has(legacyKey), false);
  assert.ok(storage.values.get(markerKey));
});

test("returns early when the migration already ran", async () => {
  const storage = new MemoryStorage();
  storage.setItem(markerKey, "2026-08-09T00:00:00.000Z");
  const writes: string[] = [];

  await withWindow({ localStorage: storage }, () =>
    migrateLegacyDraftCartLocal(recordingDb(writes))
  );

  assert.equal(writes.length, 0);
  assert.equal(storage.reads, 1);
  assert.equal(storage.values.get(markerKey), "2026-08-09T00:00:00.000Z");
});

test("skips the migration when storage access throws", async () => {
  const storage = new MemoryStorage();
  storage.failReads = true;
  const writes: string[] = [];

  await withWindow({ localStorage: storage }, () =>
    migrateLegacyDraftCartLocal(recordingDb(writes))
  );
  await withWindow(
    {
      get localStorage(): Storage {
        throw new Error("Site data is blocked");
      },
    },
    () => migrateLegacyDraftCartLocal(recordingDb(writes))
  );

  assert.equal(writes.length, 0);
});
