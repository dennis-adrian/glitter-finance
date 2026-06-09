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

export type SyncState = "initializing" | "offline" | "syncing" | "synced";

export type SyncStatusSnapshot = {
  state: SyncState;
  lastSyncedAt: Date | null;
  pendingCount: number;
};

const QUEUE_POLL_INTERVAL_MS = 5000;

export function useSyncStatus(): SyncStatusSnapshot {
  const db = useOptionalPowerSyncDb();
  const [snapshot, setSnapshot] = useState<SyncStatusSnapshot>({
    state: "initializing",
    lastSyncedAt: null,
    pendingCount: 0,
  });

  useEffect(() => {
    if (!db) {
      setSnapshot({
        state: "initializing",
        lastSyncedAt: null,
        pendingCount: 0,
      });
      return;
    }

    let cancelled = false;

    async function refresh() {
      if (cancelled || !db) return;
      const status = db.currentStatus;
      let pendingCount = 0;
      try {
        const stats = await db.getUploadQueueStats(false);
        pendingCount = stats.count;
      } catch {
        // Queue stats can fail transiently during init; treat as zero.
      }
      if (cancelled) return;

      const connected = status?.connected ?? false;
      const uploading = status?.dataFlowStatus.uploading ?? false;
      const downloading = status?.dataFlowStatus.downloading ?? false;

      let state: SyncState;
      if (!connected) {
        state = "offline";
      } else if (uploading || downloading) {
        state = "syncing";
      } else {
        state = "synced";
      }

      setSnapshot({
        state,
        lastSyncedAt: status?.lastSyncedAt ?? null,
        pendingCount,
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
