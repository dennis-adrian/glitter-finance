import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, SyncStatus } from "@powersync/web";
import {
  createSyncStatusStore,
  deriveSyncState,
  snapshotFromStatus,
  syncErrorText,
} from "@/lib/powersync/sync-status";
import {
  ActiveTenantChangedError,
  TenantClaimMismatchError,
} from "@/lib/powersync/tenant-claim";

const idleFlags = {
  connected: true,
  hasSynced: true,
  uploading: false,
  downloading: false,
  failureCount: 0,
  uploadHeld: false,
  activeTenantChanged: false,
};

test("derives one sync state, with failures first", () => {
  assert.equal(deriveSyncState(idleFlags), "synced");
  assert.equal(deriveSyncState({ ...idleFlags, uploading: true }), "syncing");
  // The first download is not complete until hasSynced turns true.
  assert.equal(deriveSyncState({ ...idleFlags, hasSynced: false }), "syncing");
  assert.equal(deriveSyncState({ ...idleFlags, connected: false }), "offline");
  assert.equal(
    deriveSyncState({ ...idleFlags, connected: false, failureCount: 1 }),
    "blocked"
  );
});

test("a held upload queue is shown as held while online", () => {
  const held = { ...idleFlags, uploadHeld: true };
  assert.equal(deriveSyncState(held), "held");
  assert.equal(deriveSyncState({ ...held, uploading: true }), "held");
  assert.equal(deriveSyncState({ ...held, connected: false }), "offline");
  assert.equal(deriveSyncState({ ...held, failureCount: 1 }), "blocked");
});

test("a tenant changed on another device is not shown as offline", () => {
  const changed = { ...idleFlags, connected: false, activeTenantChanged: true };
  assert.equal(deriveSyncState(changed), "tenant-changed");
  assert.equal(deriveSyncState({ ...changed, failureCount: 1 }), "blocked");
  // Connected again: the error PowerSync still holds is from before.
  assert.equal(deriveSyncState({ ...changed, connected: true }), "synced");
});

function disconnectedStatus(downloadError: object | undefined) {
  return {
    connected: false,
    hasSynced: true,
    lastSyncedAt: new Date("2026-09-27T12:00:00.000Z"),
    dataFlowStatus: { uploading: false, downloading: false, downloadError },
  } as unknown as SyncStatus;
}

test("the connector's tenant change error sets the state, as sent by the worker too", () => {
  const counts = { pendingCount: 0, failureCount: 0, uploadHold: null };
  const error = new ActiveTenantChangedError();

  for (const downloadError of [
    error,
    // PowerSync's shared sync worker serializes it to a plain object.
    { name: error.name, message: error.message, stack: error.stack },
  ]) {
    const snapshot = snapshotFromStatus(
      disconnectedStatus(downloadError),
      counts
    );
    assert.equal(snapshot.state, "tenant-changed");
    assert.equal(snapshot.downloadError, error.message);
  }

  assert.equal(
    snapshotFromStatus(
      disconnectedStatus(new TenantClaimMismatchError()),
      counts
    ).state,
    "offline"
  );
  assert.equal(
    snapshotFromStatus(disconnectedStatus(new Error("fetch failed")), counts)
      .state,
    "offline"
  );
});

test("sync errors are shown by their message", () => {
  assert.equal(syncErrorText(undefined), null);
  assert.equal(syncErrorText(new Error("fetch failed")), "fetch failed");
});

function fakeDb(input: {
  failureCount?: number;
  pendingCount?: number;
  holdRows?: object[];
}) {
  const state = {
    pendingCount: input.pendingCount ?? 0,
    failureCount: input.failureCount ?? 0,
    holdRows: input.holdRows ?? [],
    failureCountError: null as Error | null,
    queueReads: 0,
    listeners: new Set<{ statusChanged?: () => void }>(),
    status: {
      connected: true,
      hasSynced: true,
      lastSyncedAt: new Date("2026-09-27T12:00:00.000Z"),
      dataFlowStatus: { uploading: false, downloading: false },
    } as unknown as SyncStatus,
  };
  const db = {
    get currentStatus() {
      return state.status;
    },
    registerListener: (listener: { statusChanged?: () => void }) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    getUploadQueueStats: async () => ({ count: state.pendingCount }),
    getOptional: async () => {
      if (state.failureCountError) throw state.failureCountError;
      return { count: state.failureCount };
    },
    getAll: async (sql: string) => {
      if (/FROM upload_holds/.test(sql)) return state.holdRows;
      if (/FROM sync_failures/.test(sql)) {
        return [{ id: "transaction:7", transaction_id: 7 }];
      }
      if (/FROM ps_crud/.test(sql)) {
        state.queueReads += 1;
        return [{ tx_id: 7 }];
      }
      throw new Error(`Unexpected read: ${sql}`);
    },
    execute: async () => {},
  } as unknown as AbstractPowerSyncDatabase;
  return { db, state };
}

test("every consumer shares one status listener and poller", async () => {
  const { db, state } = fakeDb({ pendingCount: 2 });
  const store = createSyncStatusStore(db, { pollIntervalMs: 60_000 });
  let notified = 0;

  const unsubscribeFirst = store.subscribe(() => {
    notified += 1;
  });
  const unsubscribeSecond = store.subscribe(() => {});
  await store.refresh();

  assert.equal(state.listeners.size, 1);
  assert.equal(store.getSnapshot().state, "synced");
  assert.equal(store.getSnapshot().pendingCount, 2);
  assert.equal(notified, 1);

  unsubscribeFirst();
  assert.equal(state.listeners.size, 1);
  unsubscribeSecond();
  assert.equal(state.listeners.size, 0);
});

test("an unchanged status keeps the same snapshot", async () => {
  const { db } = fakeDb({});
  const store = createSyncStatusStore(db, { pollIntervalMs: 60_000 });
  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified += 1;
  });
  await store.refresh();
  const snapshot = store.getSnapshot();

  await store.refresh();
  await store.refresh();

  assert.equal(store.getSnapshot(), snapshot);
  assert.equal(notified, 1);
  unsubscribe();
});

test("failure markers are reconciled only when the counts change", async () => {
  const { db, state } = fakeDb({ failureCount: 1, pendingCount: 3 });
  const store = createSyncStatusStore(db, { pollIntervalMs: 60_000 });
  const unsubscribe = store.subscribe(() => {});
  await store.refresh();
  await store.refresh();
  await store.refresh();

  assert.equal(store.getSnapshot().state, "blocked");
  assert.equal(state.queueReads, 1);

  state.pendingCount = 4;
  for (const listener of state.listeners) listener.statusChanged?.();
  await store.refresh();
  assert.equal(state.queueReads, 2);
  unsubscribe();
});

test("a failed count read keeps the device blocked", async () => {
  const { db, state } = fakeDb({ failureCount: 1 });
  const store = createSyncStatusStore(db, { pollIntervalMs: 60_000 });
  const unsubscribe = store.subscribe(() => {});
  await store.refresh();
  assert.equal(store.getSnapshot().failureCount, 1);

  state.failureCountError = new Error("database is locked");
  await store.refresh();
  assert.equal(store.getSnapshot().failureCount, 1);
  assert.equal(store.getSnapshot().state, "blocked");
  unsubscribe();
});

const holdRow = {
  id: "transaction:7",
  transaction_id: 7,
  held_until: "2026-09-28T23:55:00.000Z",
  error_message:
    "The created_at timestamp is more than 5 minutes ahead of the server clock.",
  created_at: "2026-09-28T12:00:00.000Z",
};

test("a deferred upload holds the state until the queue moves on", async () => {
  const { db, state } = fakeDb({ pendingCount: 2, holdRows: [holdRow] });
  const store = createSyncStatusStore(db, { pollIntervalMs: 60_000 });
  const unsubscribe = store.subscribe(() => {});
  await store.refresh();

  assert.equal(store.getSnapshot().state, "held");
  assert.deepEqual(store.getSnapshot().uploadHold, {
    transactionId: 7,
    heldUntil: "2026-09-28T23:55:00.000Z",
    errorMessage: holdRow.error_message,
    createdAt: "2026-09-28T12:00:00.000Z",
  });

  // The held transaction uploaded: its row no longer matches the queue head.
  state.holdRows = [];
  await store.refresh();
  assert.equal(store.getSnapshot().state, "synced");
  assert.equal(store.getSnapshot().uploadHold, null);
  unsubscribe();
});

test("a hold never outlives the upload queue", async () => {
  const { db } = fakeDb({ pendingCount: 0, holdRows: [holdRow] });
  const store = createSyncStatusStore(db, { pollIntervalMs: 60_000 });
  const unsubscribe = store.subscribe(() => {});
  await store.refresh();

  assert.equal(store.getSnapshot().state, "synced");
  assert.equal(store.getSnapshot().uploadHold, null);
  unsubscribe();
});
