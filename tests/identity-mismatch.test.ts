import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  canDiscardUnsyncedWork,
  exportUnsyncedLocalWork,
  planIdentityMismatch,
  waitForUploadQueueToDrain,
  type UploadQueueProgress,
} from "@/lib/powersync/identity-mismatch";

const current = { userId: "user-a", tenantId: "tenant-b" };
const nothingUnsynced = {
  pendingUploadCount: 0,
  unresolvedFailureCount: 0,
  uploadHold: null,
};
const pendingOnly = {
  pendingUploadCount: 3,
  unresolvedFailureCount: 0,
  uploadHold: null,
};
const failed = {
  pendingUploadCount: 1,
  unresolvedFailureCount: 1,
  uploadHold: null,
};

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
    { action: "drain", previousTenantId: "tenant-a" }
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
    { action: "drain", previousTenantId: null }
  );
  assert.deepEqual(
    planIdentityMismatch({ stored: null, current, unsynced: failed }),
    {
      action: "block",
      block: { reason: "other-account", accountEmail: null },
    }
  );
});

test("only this user's own stuck work can be discarded", () => {
  const plan = (stored: { userId: string; tenantId: string } | null) =>
    planIdentityMismatch({ stored, current, unsynced: failed });

  assert.equal(
    canDiscardUnsyncedWork(plan({ userId: "user-a", tenantId: "tenant-a" })),
    true
  );
  assert.equal(
    canDiscardUnsyncedWork(plan({ userId: "user-z", tenantId: "tenant-z" })),
    false
  );
  assert.equal(
    canDiscardUnsyncedWork(
      planIdentityMismatch({
        stored: { userId: "user-a", tenantId: "tenant-a" },
        current,
        unsynced: pendingOnly,
      })
    ),
    false
  );
});

function queueDb(
  states: Array<{ pending: number; failures: number }>,
  options: { holdRows?: object[]; uploadError?: Error } = {}
) {
  let index = 0;
  const listeners = new Set<() => void>();
  const current = () => states[Math.min(index, states.length - 1)];
  const db = {
    currentStatus: {
      dataFlowStatus: { uploadError: options.uploadError },
    },
    getAll: async (sql: string) =>
      /FROM upload_holds/.test(sql) ? (options.holdRows ?? []) : [],
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
    onProgress: ({ pendingUploadCount }) => progress.push(pendingUploadCount),
    pollIntervalMs: 1,
  });

  assert.equal(outcome, "drained");
  assert.deepEqual(progress, [2, 1]);
  assert.equal(listenerCount(), 0);
});

test("draining says why the queue waits when the server defers it", async () => {
  const { db } = queueDb(
    [
      { pending: 2, failures: 0 },
      { pending: 0, failures: 0 },
    ],
    {
      holdRows: [
        {
          id: "transaction:9",
          transaction_id: 9,
          held_until: "2026-09-28T23:55:00.000Z",
          error_message: "The created_at timestamp is ahead.",
          created_at: "2026-09-28T12:00:00.000Z",
        },
      ],
    }
  );
  const progress: UploadQueueProgress[] = [];

  const outcome = await waitForUploadQueueToDrain(db, {
    isCancelled: () => false,
    onProgress: (update) => progress.push(update),
    pollIntervalMs: 1,
  });

  assert.equal(outcome, "drained");
  assert.deepEqual(
    progress.map(({ uploadHold, stalled }) => ({ uploadHold, stalled })),
    [
      {
        uploadHold: {
          transactionId: 9,
          heldUntil: "2026-09-28T23:55:00.000Z",
          errorMessage: "The created_at timestamp is ahead.",
          createdAt: "2026-09-28T12:00:00.000Z",
        },
        // A deferred upload waits for the server clock: offer the ways out.
        stalled: true,
      },
    ]
  );
});

test("a drain that stops uploading is stalled until an upload goes through", async () => {
  let clock = 0;
  const { db } = queueDb([
    { pending: 3, failures: 0 },
    { pending: 3, failures: 0 },
    { pending: 3, failures: 0 },
    { pending: 2, failures: 0 },
    { pending: 0, failures: 0 },
  ]);
  const progress: Array<[number, boolean]> = [];

  const outcome = await waitForUploadQueueToDrain(db, {
    isCancelled: () => false,
    onProgress: ({ pendingUploadCount, stalled }) => {
      progress.push([pendingUploadCount, stalled]);
      clock += 20_000;
    },
    pollIntervalMs: 1,
    stallAfterMs: 30_000,
    now: () => clock,
  });

  assert.equal(outcome, "drained");
  assert.deepEqual(progress, [
    [3, false],
    [3, false],
    [3, true],
    [2, false],
  ]);
});

test("a failed upload attempt stalls the drain right away and says why", async () => {
  const { db } = queueDb(
    [
      { pending: 1, failures: 0 },
      { pending: 0, failures: 0 },
    ],
    { uploadError: new Error("Failed to fetch") }
  );
  const progress: UploadQueueProgress[] = [];

  await waitForUploadQueueToDrain(db, {
    isCancelled: () => false,
    onProgress: (update) => progress.push(update),
    pollIntervalMs: 1,
  });

  assert.deepEqual(
    progress.map(({ uploadError, stalled }) => ({ uploadError, stalled })),
    [{ uploadError: "Failed to fetch", stalled: true }]
  );
});

test("draining re-checks as soon as the sync status changes", async () => {
  const { db, emitStatus } = queueDb([
    { pending: 1, failures: 0 },
    { pending: 0, failures: 0 },
  ]);

  const drained = waitForUploadQueueToDrain(db, {
    isCancelled: () => false,
    onProgress: () => setImmediate(emitStatus),
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
      onProgress: () => {
        cancelled = true;
      },
      pollIntervalMs: 1,
    }),
    "cancelled"
  );
});

test("the export keeps every queued operation and failure record", async () => {
  const failureRow = {
    id: "transaction:4",
    transaction_id: 4,
    tenant_id: "tenant-a",
    operations_json: "[]",
    error_code: "42501",
    error_message: "permission denied",
    created_at: "2026-09-28T12:00:00.000Z",
    discarded_at: null,
  };
  const db = {
    getAll: async (sql: string) => {
      if (/FROM ps_crud/.test(sql)) {
        return [
          {
            id: 7,
            tx_id: 4,
            data: JSON.stringify({
              op: "PUT",
              type: "sales",
              id: "sale-1",
              data: { tenant_id: "tenant-a", user_id: "user-a" },
            }),
          },
          { id: 8, tx_id: 5, data: "not json" },
        ];
      }
      if (/discarded_at IS NOT NULL/.test(sql)) return [];
      if (/FROM sync_failures/.test(sql)) return [failureRow];
      return [];
    },
  } as unknown as AbstractPowerSyncDatabase;

  const exported = JSON.parse(
    await exportUnsyncedLocalWork(
      db,
      {
        owner: { userId: "user-a", tenantId: "tenant-a" },
        session: current,
      },
      new Date("2026-09-28T13:00:00.000Z")
    )
  );

  assert.deepEqual(exported, {
    generatedAt: "2026-09-28T13:00:00.000Z",
    owner: { userId: "user-a", tenantId: "tenant-a" },
    session: current,
    queue: [
      {
        clientId: 7,
        transactionId: 4,
        op: "PUT",
        table: "sales",
        id: "sale-1",
        data: { tenant_id: "tenant-a", user_id: "user-a" },
      },
      { clientId: 8, transactionId: 5, raw: "not json" },
    ],
    failures: [
      {
        id: "transaction:4",
        transactionId: 4,
        tenantId: "tenant-a",
        operationsJson: "[]",
        errorCode: "42501",
        errorMessage: "permission denied",
        createdAt: "2026-09-28T12:00:00.000Z",
        discardedAt: null,
      },
    ],
    discardedFailures: [],
  });
});
