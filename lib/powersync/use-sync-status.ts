"use client";

// React hook surfacing the PowerSync sync state for UI consumption.
// Combines the database's status events (connection + uploading/downloading
// flags + lastSyncedAt) with periodic polling of the CRUD upload queue
// count, since the queue's size isn't part of the status object itself.
//
// The polling cost is a tiny local SQLite query (no network); a 5-second
// fallback poll is plenty given the queue only changes in response to local
// writes, which PR 4 will start producing.

import { useEffect, useState } from "react";
import { useOptionalPowerSyncDb } from "@/components/providers/powersync-provider";
import { getUnresolvedSyncFailureCount } from "@/lib/powersync/sync-failures";

export type SyncState =
  | "initializing"
  | "offline"
  | "syncing"
  | "synced"
  | "blocked";

export type SyncStatusSnapshot = {
  state: SyncState;
  lastSyncedAt: Date | null;
  pendingCount: number;
  failureCount: number;
};

const QUEUE_POLL_INTERVAL_MS = 5000;

export function useSyncStatus(): SyncStatusSnapshot {
  const db = useOptionalPowerSyncDb();
  const [snapshot, setSnapshot] = useState<SyncStatusSnapshot>({
    state: "initializing",
    lastSyncedAt: null,
    pendingCount: 0,
    failureCount: 0,
  });

  useEffect(() => {
    if (!db) {
      setSnapshot({
        state: "initializing",
        lastSyncedAt: null,
        pendingCount: 0,
        failureCount: 0,
      });
      return;
    }

    let cancelled = false;

    async function refresh() {
      if (cancelled || !db) return;
      const status = db.currentStatus;
      let pendingCount = 0;
      let failureCount = 0;
      // Settle each counter independently so one transient failure cannot
      // discard a valid result from the other (failed query stays at 0).
      const [statsResult, failuresResult] = await Promise.allSettled([
        db.getUploadQueueStats(false),
        getUnresolvedSyncFailureCount(db),
      ]);
      if (statsResult.status === "fulfilled") {
        pendingCount = statsResult.value.count;
      }
      if (failuresResult.status === "fulfilled") {
        failureCount = failuresResult.value;
      }
      // Rejected queries retry on the next status event/poll.
      if (cancelled) return;

      const connected = status?.connected ?? false;
      const hasSynced = status?.hasSynced ?? false;
      const uploading = status?.dataFlowStatus.uploading ?? false;
      const downloading = status?.dataFlowStatus.downloading ?? false;

      // `hasSynced` is required for the "synced" state: PowerSync can briefly
      // report connected + neither uploading nor downloading mid-way through
      // the initial bucket replication (the downloading flag toggles between
      // buckets). Showing "Sincronizado" then is a false positive — the
      // local store doesn't yet have everything. Until hasSynced flips true
      // for the first time, fall through to "syncing".
      let state: SyncState;
      if (failureCount > 0) {
        state = "blocked";
      } else if (!connected) {
        state = "offline";
      } else if (uploading || downloading || !hasSynced) {
        state = "syncing";
      } else {
        state = "synced";
      }

      setSnapshot({
        state,
        lastSyncedAt: status?.lastSyncedAt ?? null,
        pendingCount,
        failureCount,
      });
    }

    const unregister = db.registerListener({
      statusChanged: () => {
        void refresh();
      },
    });
    void refresh();
    const interval = window.setInterval(refresh, QUEUE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      unregister();
      window.clearInterval(interval);
    };
  }, [db]);

  return snapshot;
}
