import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  BROWSER_DRAFT_CART_KEY,
  browserDraftCartStorage,
} from "@/lib/browser-draft-cart";
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

test("local-only mode keeps a fresh draft cart in browser storage", async () => {
  const storage = new MemoryStorage();
  const drafts = browserDraftCartStorage();
  const updatedAt = new Date().toISOString();
  const cart = [
    {
      productId: "product-1",
      quantity: 2,
      lineDiscountCents: 100,
      lineDiscountReason: undefined,
    },
    {
      productId: "product-2",
      quantity: 1,
      lineDiscountCents: undefined,
      lineDiscountReason: "feria",
    },
  ];

  await withWindow({ localStorage: storage }, async () => {
    await drafts.save(cart, updatedAt);
    assert.deepEqual(await drafts.load(), { cart, updatedAt });

    // An emptied cart clears the draft.
    await drafts.save([], updatedAt);
    assert.equal(storage.values.has(BROWSER_DRAFT_CART_KEY), false);
  });
});

test("stale or unreadable browser drafts are dropped", async () => {
  const storage = new MemoryStorage();
  const drafts = browserDraftCartStorage();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();

  await withWindow({ localStorage: storage }, async () => {
    storage.setItem(
      BROWSER_DRAFT_CART_KEY,
      JSON.stringify({
        lines: [{ productId: "product-1", quantity: 1 }],
        updatedAt: dayAgo,
      })
    );
    assert.deepEqual(await drafts.load(), { cart: [], updatedAt: null });
    assert.equal(storage.values.has(BROWSER_DRAFT_CART_KEY), false);

    storage.setItem(BROWSER_DRAFT_CART_KEY, "{not json");
    assert.deepEqual(await drafts.load(), { cart: [], updatedAt: null });
    assert.equal(storage.values.has(BROWSER_DRAFT_CART_KEY), false);
  });
});

test("blocked browser storage never breaks the cart", async () => {
  const blocked = new MemoryStorage();
  blocked.failReads = true;
  const drafts = browserDraftCartStorage();
  const cart = [{ productId: "product-1", quantity: 1 }];

  await withWindow({ localStorage: blocked }, async () => {
    assert.deepEqual(await drafts.load(), { cart: [], updatedAt: null });
  });
  await withWindow(
    {
      get localStorage(): Storage {
        throw new Error("Site data is blocked");
      },
    },
    async () => {
      await drafts.save(cart, new Date().toISOString());
      await drafts.clear();
      assert.deepEqual(await drafts.load(), { cart: [], updatedAt: null });
    }
  );
});
