"use client";

// Small persistent indicator showing the device's sync state with PowerSync
// Cloud. Phones render it in each screen header; tablets and desktops render
// it at the bottom of the side navigation.
//
// Collapsed by default (dot + label). Tap to expand pending/failure counts
// or last successful sync timestamp.
//
// PRD §9: "A small persistent indicator shows pending mutation count and
// last successful sync timestamp."

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/dates";
import { isPowerSyncConfigured } from "@/lib/env";
import { useSyncStatus } from "@/lib/powersync/use-sync-status";
import { cn } from "@/lib/utils";

const stateLabels: Record<ReturnType<typeof useSyncStatus>["state"], string> = {
  initializing: "Conectando…",
  offline: "Sin conexión",
  syncing: "Sincronizando…",
  synced: "Sincronizado",
  blocked: "Error de sincronización",
};

type SyncStatusPillProps = {
  /** `header`: inline pill for phone headers. `nav`: stacked in the rail. */
  variant?: "header" | "nav";
  className?: string;
};

export function SyncStatusPill({
  variant = "header",
  className,
}: SyncStatusPillProps) {
  const { state, lastSyncedAt, pendingCount, failureCount } = useSyncStatus();
  const [expanded, setExpanded] = useState(false);
  const [, setNow] = useState(0);

  const showTimestamp = state === "synced" && lastSyncedAt;
  const showPending = pendingCount > 0;
  const showFailures = failureCount > 0;
  const hasMeta = Boolean(showFailures || showPending || showTimestamp);

  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!hasMeta) {
      setExpanded(false);
      return;
    }
    if (!expanded) return;
    const id = window.setTimeout(() => setExpanded(false), 4_000);
    return () => window.clearTimeout(id);
  }, [expanded, hasMeta]);

  if (!isPowerSyncConfigured()) {
    return null;
  }

  let meta: string | null = null;
  if (showFailures) {
    meta = `${failureCount} fallida${failureCount === 1 ? "" : "s"}`;
  } else if (showPending) {
    meta = `${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}`;
  } else if (showTimestamp) {
    meta = relativeTime(lastSyncedAt.toISOString()).toLowerCase();
  }

  const isExpanded = expanded && hasMeta;
  const pillClassName = cn(
    "sync-pill",
    `sync-pill-${state}`,
    variant === "nav" && "sync-pill-nav",
    isExpanded && "sync-pill-expanded",
    className
  );

  if (!hasMeta) {
    return (
      <div className={pillClassName} role="status">
        <span className="sync-pill-dot" />
        <span className="sync-pill-label">{stateLabels[state]}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={pillClassName}
      aria-expanded={isExpanded}
      aria-label={
        isExpanded && meta
          ? `${stateLabels[state]}, ${meta}`
          : stateLabels[state]
      }
      onClick={() => setExpanded((open) => !open)}
    >
      <span className="sync-pill-dot" />
      <span className="sync-pill-label">{stateLabels[state]}</span>
      {isExpanded && meta ? (
        <span className="sync-pill-meta">· {meta}</span>
      ) : null}
    </button>
  );
}
