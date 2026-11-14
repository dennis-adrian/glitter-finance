// Removes every Storage object of deleted puestos (product photos, stored
// under `<tenantId>/products/<productId>/...`, see buildProductImageObjectPath).
// Storage objects can only be deleted through the Storage API, so this runs
// after the database deletion committed, with the service-role client.

import { productImagesBucket } from "@/lib/product-image-config";

/** The part of a Storage bucket client this needs. */
export type StorageBucketLike = {
  list(
    path: string,
    options: { limit: number; offset: number }
  ): Promise<{
    data: { name: string; id: string | null }[] | null;
    error: unknown;
  }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
};

export type StorageClientLike = {
  storage: { from(bucket: string): StorageBucketLike };
};

const PAGE_SIZE = 100;
// tenant / products / product / file
const MAX_DEPTH = 4;

async function listObjectPaths(
  bucket: StorageBucketLike,
  prefix: string,
  depth: number
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await bucket.list(prefix, {
      limit: PAGE_SIZE,
      offset,
    });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      // Folders are listed without an id.
      if (entry.id === null) {
        if (depth < MAX_DEPTH) {
          paths.push(...(await listObjectPaths(bucket, path, depth + 1)));
        }
      } else {
        paths.push(path);
      }
    }
    if (entries.length < PAGE_SIZE) return paths;
  }
}

/**
 * Deletes the puestos' objects and resolves to how many it removed. Throws
 * on the first Storage error; the caller logs it, since the puestos are
 * already gone and their objects are only orphaned files.
 */
export async function removeTenantStorageObjects(
  client: StorageClientLike,
  tenantIds: readonly string[]
): Promise<number> {
  const bucket = client.storage.from(productImagesBucket);
  let removed = 0;
  for (const tenantId of tenantIds) {
    const paths = await listObjectPaths(bucket, tenantId, 1);
    for (let start = 0; start < paths.length; start += PAGE_SIZE) {
      const batch = paths.slice(start, start + PAGE_SIZE);
      const { error } = await bucket.remove(batch);
      if (error) throw error;
      removed += batch.length;
    }
  }
  return removed;
}

/**
 * The durable record of cleanup still owed (tenant_storage_cleanups, written
 * by delete_account_data in the transaction that deletes the puesto).
 */
export type StorageCleanupQueue = {
  /** Up to `limit` owed puestos, those in `first` ahead of older ones. */
  pending(first: readonly string[], limit: number): Promise<string[]>;
  /** The puesto's objects are gone: forget it. */
  complete(tenantId: string): Promise<void>;
  /** Keep it for the next run, with why this one failed. */
  fail(tenantId: string, message: string): Promise<void>;
};

/** How many owed puestos one account deletion works through. */
export const STORAGE_CLEANUP_BATCH = 20;

/**
 * Removes the objects of owed puestos, `first` (the ones just deleted) ahead
 * of what earlier runs left behind, and forgets each one only once its
 * objects are gone. A failure stays queued for the next run; nothing here
 * throws for one puesto's failure.
 */
export async function drainTenantStorageCleanups(
  client: StorageClientLike,
  queue: StorageCleanupQueue,
  first: readonly string[],
  limit = STORAGE_CLEANUP_BATCH
): Promise<{ completed: string[]; failed: string[] }> {
  const completed: string[] = [];
  const failed: string[] = [];
  for (const tenantId of await queue.pending(first, limit)) {
    try {
      await removeTenantStorageObjects(client, [tenantId]);
      await queue.complete(tenantId);
      completed.push(tenantId);
    } catch (error) {
      failed.push(tenantId);
      const message = error instanceof Error ? error.message : String(error);
      await queue.fail(tenantId, message).catch(() => {});
    }
  }
  return { completed, failed };
}
