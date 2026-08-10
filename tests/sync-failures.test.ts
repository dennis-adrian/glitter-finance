import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { reconcileSyncFailures } from "@/lib/powersync/sync-failures";

function unresolvedFailure(transactionId: number) {
  return {
    id: `transaction:${transactionId}`,
    transaction_id: transactionId,
    tenant_id: "tenant-1",
    operations_json: "[]",
    error_code: "23514",
    error_message: "Permanent failure",
    created_at: "2026-08-09T00:00:00.000Z",
  };
}

test("reconciliation clears only markers whose transactions left the queue", async () => {
  const resolvedIds: string[] = [];
  const db = {
    getAll: async () => [unresolvedFailure(17), unresolvedFailure(18)],
    getCrudTransactions: async function* () {
      yield { transactionId: 18 };
    },
    execute: async (_sql: string, params?: unknown[]) => {
      resolvedIds.push(String(params?.[1]));
    },
  } as unknown as AbstractPowerSyncDatabase;

  const resolvedCount = await reconcileSyncFailures(db);

  assert.equal(resolvedCount, 1);
  assert.deepEqual(resolvedIds, ["transaction:17"]);
});

test("reconciliation fails closed when the queue cannot be read", async () => {
  let updateAttempts = 0;
  const db = {
    getAll: async () => [unresolvedFailure(17)],
    getCrudTransactions: () => ({
      [Symbol.asyncIterator]() {
        throw new Error("Queue unavailable");
      },
    }),
    execute: async () => {
      updateAttempts += 1;
    },
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(() => reconcileSyncFailures(db), /Queue unavailable/);
  assert.equal(updateAttempts, 0);
});
