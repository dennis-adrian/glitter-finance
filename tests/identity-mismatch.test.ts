import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  planIdentityMismatch,
  waitForUploadQueueToDrain,
} from "@/lib/powersync/identity-mismatch";

const current = { userId: "user-a", tenantId: "tenant-b" };
const nothingUnsynced = { pendingUploadCount: 0, unresolvedFailureCount: 0 };
const pendingOnly = { pendingUploadCount: 3, unresolvedFailureCount: 0 };
const failed = { pendingUploadCount: 1, unresolvedFailureCount: 1 };

test("a mismatch with nothing unsynced clears the device", () => {
  for (const stored of [
    null,
    { userId: "user-a", tenantId: "tenant-a" },
    { userId: "user-z", tenantId: "tenant-z" },
  ]) {
    assert.deepEqual(
      planIdentityMismatch({ stored, current, unsynced: nothingUnsynced }),
      { action: "clear" }
    );
  }
});

test("the same user's pending uploads for another tenant drain first", () => {
  assert.deepEqual(
    planIdentityMismatch({
      stored: { userId: "user-a", tenantId: "tenant-a" },
      current,
      unsynced: pendingOnly,
    }),
    { action: "drain" }
  );
});

test("a sync failure in the previous tenant blocks and points back to it", () => {
  assert.deepEqual(
    planIdentityMismatch({
      stored: { userId: "user-a", tenantId: "tenant-a" },
      current,
      unsynced: failed,
    }),
    {
      action: "block",
      block: { reason: "previous-tenant", previousTenantId: "tenant-a" },
    }
  );
});

test("another user's unsynced work is never cleared or uploaded", () => {
  for (const unsynced of [pendingOnly, failed]) {
    assert.deepEqual(
      planIdentityMismatch({
        stored: {
          userId: "user-z",
          tenantId: "tenant-z",
          email: "ana@example.com",
        },
        current,
        unsynced,
      }),
      {
        action: "block",
        block: { reason: "other-account", accountEmail: "ana@example.com" },
      }
    );
  }
});

test("unattributed pending uploads drain, and block once they fail", () => {
  assert.deepEqual(
    planIdentityMismatch({ stored: null, current, unsynced: pendingOnly }),
    { action: "drain" }
  );
  assert.deepEqual(
    planIdentityMismatch({ stored: null, current, unsynced: failed }),
    {
      action: "block",
      block: { reason: "other-account", accountEmail: null },
    }
  );
});

function queueDb(states: Array<{ pending: number; failures: number }>) {
  let index = 0;
  const listeners = new Set<() => void>();
  const current = () => states[Math.min(index, states.length - 1)];
  const db = {
    getAll: async () => [],
    getCrudTransactions: async function* () {},
    getOptional: async () => ({ count: current().failures }),
    getUploadQueueStats: async () => {
      const state = current();
      index += 1;
      return { count: state.pending };
    },
    registerListener: (listener: { statusChanged?: () => void }) => {
      const callback = () => listener.statusChanged?.();
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  } as unknown as AbstractPowerSyncDatabase;
  return {
    db,
    listenerCount: () => listeners.size,
    emitStatus: () => [...listeners].forEach((listener) => listener()),
  };
}

test("draining waits until the upload queue is empty", async () => {
  const { db, listenerCount } = queueDb([
    { pending: 2, failures: 0 },
    { pending: 1, failures: 0 },
    { pending: 0, failures: 0 },
  ]);
  const progress: number[] = [];

  const outcome = await waitForUploadQueueToDrain(db, {
    isCancelled: () => false,
    onPending: (count) => progress.push(count),
    pollIntervalMs: 1,
  });

  assert.equal(outcome, "drained");
  assert.deepEqual(progress, [2, 1]);
  assert.equal(listenerCount(), 0);
});

test("draining re-checks as soon as the sync status changes", async () => {
  const { db, emitStatus } = queueDb([
    { pending: 1, failures: 0 },
    { pending: 0, failures: 0 },
  ]);

  const drained = waitForUploadQueueToDrain(db, {
    isCancelled: () => false,
    onPending: () => setImmediate(emitStatus),
    pollIntervalMs: 60_000,
  });

  assert.equal(await drained, "drained");
});

test("draining stops when a permanent failure blocks the queue", async () => {
  const { db } = queueDb([
    { pending: 1, failures: 0 },
    { pending: 1, failures: 1 },
  ]);

  assert.equal(
    await waitForUploadQueueToDrain(db, {
      isCancelled: () => false,
      pollIntervalMs: 1,
    }),
    "failed"
  );
});

test("draining stops when the provider unmounts", async () => {
  const { db } = queueDb([{ pending: 1, failures: 0 }]);
  let cancelled = false;

  assert.equal(
    await waitForUploadQueueToDrain(db, {
      isCancelled: () => cancelled,
      onPending: () => {
        cancelled = true;
      },
      pollIntervalMs: 1,
    }),
    "cancelled"
  );
});
