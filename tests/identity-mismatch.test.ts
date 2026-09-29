import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  canDiscardUnsyncedWork,
  canUploadUnsyncedWork,
  exportUnsyncedLocalWork,
  planIdentityMismatch,
  readUnsyncedWorkOwner,
  unsyncedWorkOwner,
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
  for (const owner of [
    null,
    { userId: "user-a", tenantId: "tenant-a" },
    { userId: "user-z", tenantId: "tenant-z" },
  ]) {
    assert.deepEqual(
      planIdentityMismatch({ owner, current, unsynced: nothingUnsynced }),
      { action: "clear" }
    );
  }
});

test("the same user's pending uploads for another tenant drain first", () => {
  assert.deepEqual(
    planIdentityMismatch({
      owner: { userId: "user-a", tenantId: "tenant-a" },
      current,
      unsynced: pendingOnly,
    }),
    { action: "drain", previousTenantId: "tenant-a" }
  );
});

test("a sync failure in the previous tenant blocks and points back to it", () => {
  assert.deepEqual(
    planIdentityMismatch({
      owner: { userId: "user-a", tenantId: "tenant-a" },
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
    const plan = planIdentityMismatch({
      owner: {
        userId: "user-z",
        tenantId: "tenant-z",
        email: "ana@example.com",
      },
      current,
      unsynced,
    });
    assert.deepEqual(plan, {
      action: "block",
      block: { reason: "other-account", accountEmail: "ana@example.com" },
    });
    assert.equal(canUploadUnsyncedWork(plan), false);
  }
});

test("work nobody can be named for drains, and blocks as unattributed once it fails", () => {
  const draining = planIdentityMismatch({
    owner: null,
    current,
    unsynced: pendingOnly,
  });
  assert.deepEqual(draining, { action: "drain", previousTenantId: null });
  assert.equal(canUploadUnsyncedWork(draining), true);

  const blocked = planIdentityMismatch({
    owner: null,
    current,
    unsynced: failed,
  });
  assert.deepEqual(blocked, {
    action: "block",
    block: { reason: "unattributed" },
  });
  // Any account used to reach this block before; now the upload keeps being
  // retried and the user can discard the work.
  assert.equal(canUploadUnsyncedWork(blocked), true);
  assert.equal(canDiscardUnsyncedWork(blocked), true);
});

test("without a marker, the owner the queue names gets its own path", () => {
  // The owner signs in on another tenant: the same-user path, with its way
  // back.
  assert.deepEqual(
    planIdentityMismatch({
      owner: unsyncedWorkOwner([sale("user-a", "tenant-a")]),
      current,
      unsynced: failed,
    }),
    {
      action: "block",
      block: { reason: "previous-tenant", previousTenantId: "tenant-a" },
    }
  );
  // The queue names the session's own tenant: nothing to go back to.
  assert.deepEqual(
    planIdentityMismatch({
      owner: unsyncedWorkOwner([sale("user-a", "tenant-b")]),
      current,
      unsynced: failed,
    }),
    {
      action: "block",
      block: { reason: "previous-tenant", previousTenantId: null },
    }
  );
  assert.deepEqual(
    planIdentityMismatch({
      owner: unsyncedWorkOwner([sale("user-a", "tenant-b")]),
      current,
      unsynced: pendingOnly,
    }),
    { action: "drain", previousTenantId: null }
  );
  // Another user signs in: blocked before any upload is rejected.
  assert.deepEqual(
    planIdentityMismatch({
      owner: unsyncedWorkOwner([sale("user-z", "tenant-z")]),
      current,
      unsynced: pendingOnly,
    }),
    {
      action: "block",
      block: { reason: "other-account", accountEmail: null },
    }
  );
});

test("only this user's own stuck work can be discarded", () => {
  const plan = (owner: { userId: string; tenantId: string } | null) =>
    planIdentityMismatch({ owner, current, unsynced: failed });

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
        owner: { userId: "user-a", tenantId: "tenant-a" },
        current,
        unsynced: pendingOnly,
      })
    ),
    false
  );
});

function sale(userId: string, tenantId: string) {
  return {
    table: "sales",
    data: { id: "sale-1", tenant_id: tenantId, user_id: userId },
  };
}

test("the queue names its owner by the user its writes carry", () => {
  assert.deepEqual(
    unsyncedWorkOwner([
      sale("user-a", "tenant-a"),
      { table: "sale_lines", data: { tenant_id: "tenant-a" } },
      {
        table: "refunds",
        data: { tenant_id: "tenant-a", user_id: "user-a" },
      },
      {
        table: "inventory_movements",
        data: { tenant_id: "tenant-a", user_id: "user-a" },
      },
    ]),
    { userId: "user-a", tenantId: "tenant-a", email: null }
  );
  // A void only carries who voided it, not the tenant.
  assert.deepEqual(
    unsyncedWorkOwner([
      {
        table: "sales",
        data: {
          voided_at: "2026-09-28T12:00:00.000Z",
          voided_by_user_id: "user-a",
        },
      },
    ]),
    { userId: "user-a", tenantId: null, email: null }
  );
  assert.deepEqual(
    unsyncedWorkOwner([sale("user-a", "tenant-a"), sale("user-a", "tenant-c")]),
    { userId: "user-a", tenantId: null, email: null }
  );
});

test("a queue that names no user, or several, has no owner", () => {
  assert.equal(
    unsyncedWorkOwner([
      { table: "products", data: { tenant_id: "tenant-a", name: "Aretes" } },
      { table: "products", data: { price_cents: 1500 } },
      // Not a column that names who recorded the write.
      { table: "tenant_users", data: { user_id: "user-z" } },
    ]),
    null
  );
  assert.equal(
    unsyncedWorkOwner([sale("user-a", "tenant-a"), sale("user-z", "tenant-a")]),
    null
  );
});

test("the owner is read from the upload queue rows", async () => {
  const db = {
    getAll: async (sql: string) =>
      /FROM ps_crud/.test(sql)
        ? [
            {
              id: 1,
              tx_id: 1,
              data: JSON.stringify({
                op: "PUT",
                type: "sales",
                id: "sale-1",
                data: { tenant_id: "tenant-a", user_id: "user-a" },
              }),
            },
            { id: 2, tx_id: 2, data: "not json" },
          ]
        : [],
  } as unknown as AbstractPowerSyncDatabase;

  assert.deepEqual(await readUnsyncedWorkOwner(db), {
    userId: "user-a",
    tenantId: "tenant-a",
    email: null,
  });
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

test("a permanent failure keeps the drain waiting until a retry goes through", async () => {
  const { db } = queueDb([
    { pending: 1, failures: 0 },
    { pending: 1, failures: 1 },
    { pending: 1, failures: 1 },
    { pending: 0, failures: 0 },
  ]);
  const progress: Array<[number, boolean]> = [];

  assert.equal(
    await waitForUploadQueueToDrain(db, {
      isCancelled: () => false,
      onProgress: ({ unresolvedFailureCount, stalled }) =>
        progress.push([unresolvedFailureCount, stalled]),
      pollIntervalMs: 1,
    }),
    "drained"
  );
  assert.deepEqual(progress, [
    [0, false],
    [1, true],
    [1, true],
  ]);
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
