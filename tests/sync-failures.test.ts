import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { reconcileSyncFailures } from "@/lib/powersync/sync-failures";

function marker(transactionId: number) {
  return { id: `transaction:${transactionId}`, transaction_id: transactionId };
}

test("reconciliation clears only markers whose transactions left the queue", async () => {
  const reads: { sql: string; params?: unknown[] }[] = [];
  const writes: { sql: string; params?: unknown[] }[] = [];
  const db = {
    getAll: async (sql: string, params?: unknown[]) => {
      reads.push({ sql, params });
      if (/FROM sync_failures/.test(sql)) return [marker(17), marker(18)];
      if (/FROM ps_crud/.test(sql)) return [{ tx_id: 18 }];
      throw new Error(`Unexpected read: ${sql}`);
    },
    getCrudTransactions: () => {
      throw new Error("Reconciliation must not walk the upload queue.");
    },
    execute: async (sql: string, params?: unknown[]) => {
      writes.push({ sql, params });
    },
  } as unknown as AbstractPowerSyncDatabase;

  const resolvedCount = await reconcileSyncFailures(db);

  assert.equal(resolvedCount, 1);
  // One read of the queue, restricted to the markers' transactions.
  assert.equal(reads.length, 2);
  assert.deepEqual(JSON.parse(String(reads[1].params?.[0])), [17, 18]);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /UPDATE sync_failures/);
  assert.deepEqual(JSON.parse(String(writes[0].params?.[1])), [
    "transaction:17",
  ]);
});

test("reconciliation reads nothing else when no marker is unresolved", async () => {
  const reads: string[] = [];
  const db = {
    getAll: async (sql: string) => {
      reads.push(sql);
      return [];
    },
    execute: async () => {
      throw new Error("Nothing to resolve.");
    },
  } as unknown as AbstractPowerSyncDatabase;

  assert.equal(await reconcileSyncFailures(db), 0);
  assert.equal(reads.length, 1);
});

test("reconciliation fails closed when the queue cannot be read", async () => {
  let updateAttempts = 0;
  const db = {
    getAll: async (sql: string) => {
      if (/FROM sync_failures/.test(sql)) return [marker(17)];
      throw new Error("Queue unavailable");
    },
    execute: async () => {
      updateAttempts += 1;
    },
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(() => reconcileSyncFailures(db), /Queue unavailable/);
  assert.equal(updateAttempts, 0);
});
