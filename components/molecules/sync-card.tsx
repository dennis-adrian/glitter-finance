"use client";

// "Sincronización" in Más: when this device last synced, what its state
// means for the vendor's sales, and a button to try again now. The button
// reconnects PowerSync, like "Forzar sincronización" in Diagnósticos; it
// cannot get ahead of a full sync service, which summarizeSync explains.

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { usePowerSyncControls } from "@/components/providers/powersync-provider";
import { Button } from "@/components/ui/button";
import { isPowerSyncConfigured } from "@/lib/env";
import { summarizeSync } from "@/lib/powersync/sync-summary";
import { useSyncStatus } from "@/lib/powersync/use-sync-status";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

export function SyncCard({ className }: { className?: string }) {
  const status = useSyncStatus();
  const controls = usePowerSyncControls();
  const [now] = useNow(30_000);
  const [syncing, setSyncing] = useState(false);

  if (!isPowerSyncConfigured()) return null;

  const summary = summarizeSync(status, now);

  async function syncNow() {
    if (!controls || syncing) return;
    setSyncing(true);
    try {
      await controls.reconnect();
    } catch (error) {
      console.error("[Sync] manual sync failed", error);
      toast.error(
        "No se pudo sincronizar. Revisá la conexión e intentalo de nuevo."
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section
      className={cn(
        "rounded-3xl border border-primary/10 bg-card p-4 shadow-[0_4px_12px_rgba(45,27,20,0.06)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.18)]",
        className
      )}
      aria-labelledby="sync-card-title"
    >
      <h2
        id="sync-card-title"
        className="text-xs font-semibold text-muted-foreground"
      >
        Sincronización
      </h2>
      <p className="mt-1 text-[15px] font-bold" role="status">
        {summary.headline}
      </p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {summary.lastSynced}
      </p>
      {summary.detail ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {summary.detail}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="mt-4 min-h-11 w-full rounded-xl sm:w-auto"
        onClick={() => void syncNow()}
        disabled={!controls || syncing || !summary.canSyncNow}
      >
        <RefreshCw
          className={cn("size-4", syncing && "animate-spin")}
          aria-hidden
        />
        {syncing ? "Sincronizando…" : "Sincronizar ahora"}
      </Button>
    </section>
  );
}
