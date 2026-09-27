// The device's sync state, read once for the whole app.
//
// PowerSyncProvider creates one SyncStatusStore per database, and the pill,
// More, Settings, the join form and Diagnostics all read it through
// useSyncStatus. The store listens to PowerSync's status events and polls the
// upload queue (whose size is not part of the status) on a single interval,
// only while something is subscribed.

import type { AbstractPowerSyncDatabase, SyncStatus } from "@powersync/web";
import {
  getUnresolvedSyncFailureCount,
  reconcileSyncFailures,
} from "@/lib/powersync/sync-failures";

export type SyncState =
  | "initializing"
  | "offline"
  | "syncing"
  | "synced"
  | "blocked";

export type SyncStatusSnapshot = {
  state: SyncState;
  connected: boolean;
  hasSynced: boolean;
  uploading: boolean;
  downloading: boolean;
  lastSyncedAt: Date | null;
  uploadError: string | null;
  downloadError: string | null;
  pendingCount: number;
  failureCount: number;
};

export const initialSyncStatusSnapshot: SyncStatusSnapshot = {
  state: "initializing",
  connected: false,
  hasSynced: false,
  uploading: false,
  downloading: false,
  lastSyncedAt: null,
  uploadError: null,
  downloadError: null,
  pendingCount: 0,
  failureCount: 0,
};

// A tiny local SQLite read, no network. The queue only changes on local
// writes and uploads, which also raise status events.
export const SYNC_STATUS_POLL_INTERVAL_MS = 5_000;

export function deriveSyncState(input: {
  connected: boolean;
  hasSynced: boolean;
  uploading: boolean;
  downloading: boolean;
  failureCount: number;
}): SyncState {
  if (input.failureCount > 0) return "blocked";
  if (!input.connected) return "offline";
  // PowerSync can briefly report connected with neither flag set in the
  // middle of the first download (the downloading flag toggles between
  // buckets). The local store is not complete until hasSynced first turns
  // true, so "Sincronizado" before that would be a false positive.
  if (input.uploading || input.downloading || !input.hasSynced) {
    return "syncing";
  }
  return "synced";
}

/** The text of an upload or download error from PowerSync's status. */
export function syncErrorText(
  error: { message?: unknown } | null | undefined
): string | null {
  if (!error) return null;
  return String(error.message ?? error);
}

export function snapshotFromStatus(
  status: SyncStatus | null | undefined,
  counts: { pendingCount: number; failureCount: number }
): SyncStatusSnapshot {
  const flags = {
    connected: status?.connected ?? false,
    hasSynced: status?.hasSynced ?? false,
    uploading: status?.dataFlowStatus.uploading ?? false,
    downloading: status?.dataFlowStatus.downloading ?? false,
  };
  return {
    state: deriveSyncState({ ...flags, failureCount: counts.failureCount }),
    ...flags,
    lastSyncedAt: status?.lastSyncedAt ?? null,
    uploadError: syncErrorText(status?.dataFlowStatus.uploadError),
    downloadError: syncErrorText(status?.dataFlowStatus.downloadError),
    pendingCount: counts.pendingCount,
    failureCount: counts.failureCount,
  };
}

export function sameSyncStatus(
  a: SyncStatusSnapshot,
  b: SyncStatusSnapshot
): boolean {
  return (
    a.state === b.state &&
    a.connected === b.connected &&
    a.hasSynced === b.hasSynced &&
    a.uploading === b.uploading &&
    a.downloading === b.downloading &&
    (a.lastSyncedAt?.getTime() ?? null) ===
      (b.lastSyncedAt?.getTime() ?? null) &&
    a.uploadError === b.uploadError &&
    a.downloadError === b.downloadError &&
    a.pendingCount === b.pendingCount &&
    a.failureCount === b.failureCount
  );
}

/** Shaped for React's useSyncExternalStore. */
export type SyncStatusStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SyncStatusSnapshot;
  /** Reads the status again now, e.g. after an action changed the queue. */
  refresh: () => Promise<void>;
};

/** The store while no database is ready. */
export const idleSyncStatusStore: SyncStatusStore = {
  subscribe: () => () => {},
  getSnapshot: () => initialSyncStatusSnapshot,
  refresh: async () => {},
};

export function createSyncStatusStore(
  db: AbstractPowerSyncDatabase,
  options: { pollIntervalMs?: number } = {}
): SyncStatusStore {
  const pollIntervalMs = options.pollIntervalMs ?? SYNC_STATUS_POLL_INTERVAL_MS;
  const listeners = new Set<() => void>();
  let snapshot = initialSyncStatusSnapshot;
  let stopWatching: (() => void) | null = null;
  let running: Promise<void> | null = null;
  let rerun = false;
  // The counts the failure markers were last reconciled at.
  let reconciledAt: { pendingCount: number; failureCount: number } | null =
    null;

  function publish(next: SyncStatusSnapshot) {
    if (sameSyncStatus(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function read() {
    const status = db.currentStatus;
    const [stats, failures] = await Promise.allSettled([
      db.getUploadQueueStats(false),
      getUnresolvedSyncFailureCount(db),
    ]);
    // A rejected read keeps the last known count, so a failure marker keeps
    // the device blocked (fails closed) instead of clearing mid-outage. It is
    // read again on the next event or poll.
    const pendingCount =
      stats.status === "fulfilled" ? stats.value.count : snapshot.pendingCount;
    let failureCount =
      failures.status === "fulfilled" ? failures.value : snapshot.failureCount;

    // A marker only goes stale when its transaction leaves the queue, and the
    // connector reconciles after every upload it completes. This catches
    // anything else, without reading the queue again until it changes.
    if (
      failureCount > 0 &&
      (reconciledAt?.pendingCount !== pendingCount ||
        reconciledAt.failureCount !== failureCount)
    ) {
      try {
        if ((await reconcileSyncFailures(db)) > 0) {
          failureCount = await getUnresolvedSyncFailureCount(db);
        }
        reconciledAt = { pendingCount, failureCount };
      } catch (error) {
        console.error("[PowerSync] sync failure reconciliation failed", {
          error,
        });
      }
    }

    publish(snapshotFromStatus(status, { pendingCount, failureCount }));
  }

  // Status events come in bursts; one read at a time, plus one more if
  // anything asked while it ran.
  function refresh(): Promise<void> {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          rerun = false;
          await read();
        } while (rerun);
      } catch (error) {
        console.error("[PowerSync] sync status read failed", { error });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function start() {
    const unregister = db.registerListener({
      statusChanged: () => {
        void refresh();
      },
    });
    const interval = setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    stopWatching = () => {
      unregister();
      clearInterval(interval);
    };
    void refresh();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopWatching?.();
          stopWatching = null;
        }
      };
    },
    getSnapshot: () => snapshot,
    refresh,
  };
}
