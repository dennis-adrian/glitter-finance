// Removing the Storage objects of the puestos an account deletion deleted
// (lib/tenant-storage-cleanup.ts).

import assert from "node:assert/strict";
import test from "node:test";
import {
  drainTenantStorageCleanups,
  removeTenantStorageObjects,
  type StorageBucketLike,
} from "@/lib/tenant-storage-cleanup";

function fakeStorage(files: string[], options: { failRemove?: boolean } = {}) {
  const removed: string[][] = [];
  const buckets: string[] = [];
  const bucket: StorageBucketLike = {
    async list(path, { limit, offset }) {
      const prefix = `${path}/`;
      const names = new Map<string, boolean>();
      for (const file of files) {
        if (!file.startsWith(prefix)) continue;
        const [name, ...rest] = file.slice(prefix.length).split("/");
        names.set(name, rest.length > 0);
      }
      const entries = [...names].map(([name, isFolder]) => ({
        name,
        id: isFolder ? null : `id-${name}`,
      }));
      return { data: entries.slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      if (options.failRemove) return { error: new Error("denied") };
      removed.push(paths);
      return { error: null };
    },
  };
  return {
    client: {
      storage: {
        from(name: string) {
          buckets.push(name);
          return bucket;
        },
      },
    },
    removed,
    buckets,
  };
}

test("removes every photo of the deleted puestos, and nothing else", async () => {
  const storage = fakeStorage([
    "t1/products/p1/a.jpg",
    "t1/products/p1/b.jpg",
    "t1/products/p2/c.png",
    "t2/products/p3/d.jpg",
  ]);

  assert.equal(await removeTenantStorageObjects(storage.client, ["t1"]), 3);
  assert.deepEqual(storage.buckets, ["product-images"]);
  assert.deepEqual(storage.removed.flat().sort(), [
    "t1/products/p1/a.jpg",
    "t1/products/p1/b.jpg",
    "t1/products/p2/c.png",
  ]);
});

test("pages through long listings and removes in batches", async () => {
  const files = Array.from(
    { length: 250 },
    (_, index) => `t1/products/p${index}/photo.jpg`
  );
  const storage = fakeStorage(files);

  assert.equal(await removeTenantStorageObjects(storage.client, ["t1"]), 250);
  assert.deepEqual(
    storage.removed.map((batch) => batch.length),
    [100, 100, 50]
  );
});

test("a puesto without photos removes nothing", async () => {
  const storage = fakeStorage([]);

  assert.equal(await removeTenantStorageObjects(storage.client, ["t1"]), 0);
  assert.deepEqual(storage.removed, []);
});

test("a Storage error is thrown for the caller to log", async () => {
  const storage = fakeStorage(["t1/products/p1/a.jpg"], { failRemove: true });

  await assert.rejects(removeTenantStorageObjects(storage.client, ["t1"]));
});

function fakeQueue(owed: string[]) {
  const failures = new Map<string, string>();
  const asked: { first: readonly string[]; limit: number }[] = [];
  return {
    owed,
    failures,
    asked,
    queue: {
      async pending(first: readonly string[], limit: number) {
        asked.push({ first, limit });
        return [
          ...owed.filter((id) => first.includes(id)),
          ...owed.filter((id) => !first.includes(id)),
        ].slice(0, limit);
      },
      async complete(tenantId: string) {
        owed.splice(owed.indexOf(tenantId), 1);
      },
      async fail(tenantId: string, message: string) {
        failures.set(tenantId, message);
      },
    },
  };
}

test("a puesto is forgotten only once its photos are gone, and a failure stays queued", async () => {
  // t-old was left by an earlier run whose Storage call failed.
  const queue = fakeQueue(["t-old", "t-new"]);
  const storage = fakeStorage([
    "t-old/products/p1/a.jpg",
    "t-new/products/p2/b.jpg",
  ]);

  const result = await drainTenantStorageCleanups(
    storage.client,
    queue.queue,
    ["t-new"],
    5
  );

  assert.deepEqual(result, { completed: ["t-new", "t-old"], failed: [] });
  assert.deepEqual(queue.asked, [{ first: ["t-new"], limit: 5 }]);
  assert.deepEqual(queue.owed, []);

  const failing = fakeQueue(["t1"]);
  const down = fakeStorage(["t1/products/p1/a.jpg"], { failRemove: true });
  assert.deepEqual(
    await drainTenantStorageCleanups(down.client, failing.queue, ["t1"]),
    { completed: [], failed: ["t1"] }
  );
  assert.deepEqual(failing.owed, ["t1"], "the next run retries it");
  assert.equal(failing.failures.get("t1"), "denied");
});
