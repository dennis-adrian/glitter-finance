import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, SyncStatus } from "@powersync/web";
import {
  createSyncStatusStore,
  deriveSyncState,
  syncErrorText,
} from "@/lib/powersync/sync-status";

const idleFlags = {
  connected: true,
  hasSynced: true,
  uploading: false,
  downloading: false,
  failureCount: 0,
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

test("sync errors are shown by their message", () => {
  assert.equal(syncErrorText(undefined), null);
  assert.equal(syncErrorText(new Error("fetch failed")), "fetch failed");
});

function fakeDb(input: { failureCount?: number; pendingCount?: number }) {
  const state = {
    pendingCount: input.pendingCount ?? 0,
    failureCount: input.failureCount ?? 0,
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
