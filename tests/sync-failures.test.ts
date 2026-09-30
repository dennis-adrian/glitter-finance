import assert from "node:assert/strict";
import test from "node:test";
import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  Transaction,
} from "@powersync/web";
import {
  describeSyncFailure,
  parseSyncFailureOperations,
  reconcileSyncFailures,
  recordSyncFailure,
  resolveSyncFailure,
} from "@/lib/powersync/sync-failures";

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

test("a discarded failure is not recorded again by a late upload", async () => {
  const writes: string[] = [];
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        getOptional: async () => ({
          created_at: "2026-09-27T12:00:00.000Z",
          resolved_at: "2026-09-27T12:05:00.000Z",
          discarded_at: "2026-09-27T12:05:00.000Z",
        }),
        execute: async (sql: string) => {
          writes.push(sql);
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;

  await recordSyncFailure(db, {
    transactionId: 9,
    operations: [] as CrudEntry[],
    error: { code: "23514", message: "check violation" },
  });

  assert.deepEqual(writes, []);
});

test("an upload that got through withdraws a pending decision to discard it", async () => {
  const writes: { sql: string; params?: unknown[] }[] = [];
  const db = {
    execute: async (sql: string, params?: unknown[]) => {
      writes.push({ sql, params });
    },
  } as unknown as AbstractPowerSyncDatabase;

  await resolveSyncFailure(db, { transactionId: 9, operations: [] });

  assert.equal(writes.length, 1);
  // Only a marker still pending: a completed discard stands.
  assert.match(
    writes[0].sql,
    /SET resolved_at = \?, discarded_at = NULL\s+WHERE id = \? AND resolved_at IS NULL/
  );
  assert.equal(writes[0].params?.[1], "transaction:9");
});

test("stored payloads are read back and described", () => {
  const operationsJson = JSON.stringify([
    {
      op_id: 3,
      op: "PATCH",
      type: "sales",
      id: "sale-1",
      tx_id: 9,
      data: { voided_at: "2026-09-27T12:00:00.000Z" },
    },
    { op_id: "bad" },
  ]);

  assert.deepEqual(parseSyncFailureOperations(operationsJson), [
    {
      clientId: 3,
      op: "PATCH",
      table: "sales",
      id: "sale-1",
      data: { voided_at: "2026-09-27T12:00:00.000Z" },
    },
  ]);
  assert.equal(describeSyncFailure(operationsJson), "Anulación de venta");
  assert.equal(
    describeSyncFailure(
      JSON.stringify([
        { op_id: 1, op: "PUT", type: "sales", id: "s", data: {} },
        { op_id: 2, op: "PUT", type: "sale_lines", id: "l", data: {} },
      ])
    ),
    "Venta"
  );
  assert.equal(
    describeSyncFailure(
      JSON.stringify([
        { op_id: 1, op: "PATCH", type: "categories", id: "c", data: {} },
        { op_id: 2, op: "PATCH", type: "products", id: "p", data: {} },
      ])
    ),
    "Cambio de categoría"
  );
  assert.equal(describeSyncFailure("not json"), "Operación");
});
