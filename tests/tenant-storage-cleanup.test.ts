// Removing the Storage objects of the puestos an account deletion deleted
// (lib/tenant-storage-cleanup.ts).

import assert from "node:assert/strict";
import test from "node:test";
import {
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
