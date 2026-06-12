"use client";

// Small persistent indicator showing the device's sync state with PowerSync
// Cloud. Pinned top-right inside the phone-frame so it's visible across
// every screen without interfering with screen-specific layouts.
//
// PRD §9: "A small persistent indicator shows pending mutation count and
// last successful sync timestamp."

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/dates";
import { useSyncStatus } from "@/lib/powersync/use-sync-status";

const stateLabels: Record<ReturnType<typeof useSyncStatus>["state"], string> = {
  initializing: "Conectando…",
  offline: "Sin conexión",
  syncing: "Sincronizando…",
  synced: "Sincronizado",
};

export function SyncStatusPill() {
  const { state, lastSyncedAt, pendingCount } = useSyncStatus();
  // Re-render every 30s so the "hace X" timestamp stays roughly fresh
  // without flooding the React tree on every tick.
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const showTimestamp = state === "synced" && lastSyncedAt;
  const showPending = pendingCount > 0;

  return (
    <div className={`sync-pill sync-pill-${state}`}>
      <span className="sync-pill-dot" />
      <span className="sync-pill-label">{stateLabels[state]}</span>
      {showPending ? (
        <span className="sync-pill-meta">
          · {pendingCount} pendiente{pendingCount === 1 ? "" : "s"}
        </span>
      ) : showTimestamp ? (
        <span className="sync-pill-meta">
          · {relativeTime(lastSyncedAt.toISOString()).toLowerCase()}
        </span>
      ) : null}
    </div>
  );
}
