"use client";

// Tester-only diagnostics screen. Surfaces what testers need to write a
// useful bug report — sync state, upload queue, identity, device info —
// plus a "Forzar sincronización" action that reconnects PowerSync (kicking
// the queue) and a "Copiar diagnóstico" action that dumps everything as
// JSON to the clipboard. Per PRD §8 + §14.

import {
  AlertTriangle,
  ChevronLeft,
  RefreshCw,
  ClipboardCopy,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Header } from "@/components/atoms/header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useOptionalPowerSyncDb,
  usePowerSyncControls,
} from "@/components/providers/powersync-provider";
import type { UserTenantContext } from "@/lib/auth/user-context";
import {
  getUnresolvedSyncFailures,
  type SyncFailure,
} from "@/lib/powersync/sync-failures";

type Snapshot = {
  connected: boolean;
  hasSynced: boolean;
  lastSyncedAt: string | null;
  uploading: boolean;
  downloading: boolean;
  uploadError: string | null;
  downloadError: string | null;
  pendingCount: number;
  pendingBytes: number | null;
  failures: SyncFailure[];
};

const emptySnapshot: Snapshot = {
  connected: false,
  hasSynced: false,
  lastSyncedAt: null,
  uploading: false,
  downloading: false,
  uploadError: null,
  downloadError: null,
  pendingCount: 0,
  pendingBytes: null,
  failures: [],
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function yesNo(value: boolean): string {
  return value ? "Sí" : "No";
}

type DeviceInfo = {
  userAgent: string;
  viewport: string;
  online: boolean;
  pwa: boolean;
  storage: string;
};

function readDeviceInfoSync(): DeviceInfo {
  return {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "—",
    viewport:
      typeof window !== "undefined"
        ? `${window.innerWidth} × ${window.innerHeight}`
        : "—",
    online: typeof navigator !== "undefined" ? navigator.onLine : false,
    pwa:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)").matches
        : false,
    storage: "—",
  };
}

type DiagnosticsScreenProps = {
  tenantContext: UserTenantContext;
  back: () => void;
};

export function DiagnosticsScreen({
  tenantContext,
  back,
}: DiagnosticsScreenProps) {
  const db = useOptionalPowerSyncDb();
  const controls = usePowerSyncControls();
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [device, setDevice] = useState<DeviceInfo>(readDeviceInfoSync);
  const [reconnecting, setReconnecting] = useState(false);
  const [copyConfirmed, setCopyConfirmed] = useState(false);

  // Sync state — re-fetch on status changes plus a 2s poll for the queue
  // count, which isn't part of the status event stream.
  useEffect(() => {
    if (!db) {
      setSnapshot(emptySnapshot);
      return;
    }
    let cancelled = false;

    async function refresh() {
      if (cancelled || !db) return;
      const status = db.currentStatus;
      let pendingCount = 0;
      let pendingBytes: number | null = null;
      let failures: SyncFailure[] = [];
      try {
        const [stats, unresolvedFailures] = await Promise.all([
          db.getUploadQueueStats(true),
          getUnresolvedSyncFailures(db),
        ]);
        pendingCount = stats.count;
        pendingBytes = stats.size;
        failures = unresolvedFailures;
      } catch {
        // Transient init/query failure — leave at defaults.
      }
      if (cancelled) return;
      setSnapshot({
        connected: status?.connected ?? false,
        hasSynced: status?.hasSynced ?? false,
        lastSyncedAt: status?.lastSyncedAt?.toISOString() ?? null,
        uploading: status?.dataFlowStatus.uploading ?? false,
        downloading: status?.dataFlowStatus.downloading ?? false,
        uploadError: status?.dataFlowStatus.uploadError
          ? String(
              status.dataFlowStatus.uploadError.message ??
                status.dataFlowStatus.uploadError
            )
          : null,
        downloadError: status?.dataFlowStatus.downloadError
          ? String(
              status.dataFlowStatus.downloadError.message ??
                status.dataFlowStatus.downloadError
            )
          : null,
        pendingCount,
        pendingBytes,
        failures,
      });
    }

    const unregister = db.registerListener({
      statusChanged: () => {
        void refresh();
      },
    });
    void refresh();
    const interval = window.setInterval(refresh, 2000);

    return () => {
      cancelled = true;
      unregister();
      window.clearInterval(interval);
    };
  }, [db]);

  // Device info — refresh on online/offline events and an async storage
  // estimate (StorageManager API isn't always available; falls back to "—").
  useEffect(() => {
    function refreshDevice() {
      setDevice(readDeviceInfoSync());
    }
    window.addEventListener("online", refreshDevice);
    window.addEventListener("offline", refreshDevice);
    window.addEventListener("resize", refreshDevice);

    async function loadStorage() {
      if (
        typeof navigator !== "undefined" &&
        navigator.storage &&
        typeof navigator.storage.estimate === "function"
      ) {
        try {
          const estimate = await navigator.storage.estimate();
          const used = estimate.usage ?? 0;
          const quota = estimate.quota ?? 0;
          setDevice((current) => ({
            ...current,
            storage: `${formatBytes(used)} / ${formatBytes(quota)}`,
          }));
        } catch {
          // Leave storage as "—".
        }
      }
    }
    void loadStorage();

    return () => {
      window.removeEventListener("online", refreshDevice);
      window.removeEventListener("offline", refreshDevice);
      window.removeEventListener("resize", refreshDevice);
    };
  }, []);

  async function handleReconnect() {
    if (!controls || reconnecting) return;
    setReconnecting(true);
    try {
      await controls.reconnect();
    } catch (error) {
      console.error("[Diagnostics] reconnect failed", error);
    } finally {
      setReconnecting(false);
    }
  }

  async function handleCopy() {
    const payload = {
      generatedAt: new Date().toISOString(),
      sync: snapshot,
      identity: {
        tenantId: tenantContext.tenant?.id ?? null,
        tenantName: tenantContext.tenant?.name ?? null,
        userId: tenantContext.user.id,
        displayName: tenantContext.user.displayName,
        email: tenantContext.user.email,
      },
      device,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyConfirmed(true);
      window.setTimeout(() => setCopyConfirmed(false), 1800);
    } catch (error) {
      console.error("[Diagnostics] copy failed", error);
    }
  }

  return (
    <section className="screen">
      <Header
        title="Diagnósticos"
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={back}
            aria-label="Volver"
          >
            <ChevronLeft className="size-6" />
          </Button>
        }
      />

      {snapshot.failures.length ? (
        <div
          className="mt-3 flex gap-2 rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-[17px] shrink-0" />
          <span>
            {snapshot.failures.length === 1
              ? "1 operación no llegó a la nube."
              : `${snapshot.failures.length} operaciones no llegaron a la nube.`}{" "}
            Copia este diagnóstico y no cierres sesión ni cambies de cuenta
            hasta{" "}
            {snapshot.failures.length === 1 ? "recuperarla" : "recuperarlas"}.
          </span>
        </div>
      ) : null}

      <DiagPanel title="Sincronización">
        <DiagRow label="Conectado" value={yesNo(snapshot.connected)} />
        <DiagRow label="Sincronizado" value={yesNo(snapshot.hasSynced)} />
        <DiagRow
          label="Última sincronización"
          value={snapshot.lastSyncedAt ?? "—"}
          mono
        />
        <DiagRow label="Subiendo" value={yesNo(snapshot.uploading)} />
        <DiagRow label="Bajando" value={yesNo(snapshot.downloading)} />
        {snapshot.uploadError ? (
          <DiagRow label="Error de subida" value={snapshot.uploadError} mono />
        ) : null}
        {snapshot.downloadError ? (
          <DiagRow
            label="Error de bajada"
            value={snapshot.downloadError}
            mono
          />
        ) : null}
      </DiagPanel>

      <DiagPanel title="Cola de subida">
        <DiagRow
          label="Operaciones pendientes"
          value={String(snapshot.pendingCount)}
        />
        <DiagRow
          label="Tamaño aproximado"
          value={formatBytes(snapshot.pendingBytes)}
        />
        <DiagRow
          label="Operaciones fallidas"
          value={String(snapshot.failures.length)}
        />
        {snapshot.failures[0] ? (
          <>
            <DiagRow
              label="Último código"
              value={snapshot.failures[0].errorCode ?? "—"}
              mono
            />
            <DiagRow
              label="Último error"
              value={snapshot.failures[0].errorMessage}
              mono
            />
          </>
        ) : null}
      </DiagPanel>

      <DiagPanel title="Identidad">
        <DiagRow label="Tenant" value={tenantContext.tenant?.id ?? "—"} mono />
        <DiagRow
          label="Nombre del tenant"
          value={tenantContext.tenant?.name ?? "—"}
        />
        <DiagRow label="Usuario" value={tenantContext.user.id} mono />
        <DiagRow label="Nombre" value={tenantContext.user.displayName} />
        <DiagRow label="Email" value={tenantContext.user.email ?? "—"} />
      </DiagPanel>

      <DiagPanel title="Dispositivo">
        <DiagRow
          label="Conexión"
          value={device.online ? "Online" : "Offline"}
        />
        <DiagRow label="Modo PWA" value={yesNo(device.pwa)} />
        <DiagRow label="Pantalla" value={device.viewport} />
        <DiagRow label="Almacenamiento" value={device.storage} />
        <DiagRow label="User Agent" value={device.userAgent} mono small />
      </DiagPanel>

      <div className="mt-4 grid gap-2.5">
        <Button
          size="lg"
          onClick={handleReconnect}
          disabled={!controls || reconnecting}
        >
          <RefreshCw className="size-[18px]" />
          {reconnecting ? "Reconectando…" : "Forzar sincronización"}
        </Button>
        <Button variant="outline" size="lg" onClick={handleCopy}>
          <ClipboardCopy className="size-[18px]" />
          {copyConfirmed ? "Copiado" : "Copiar diagnóstico"}
        </Button>
      </div>
    </section>
  );
}

function DiagPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="mb-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

type DiagRowProps = {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
};

function DiagRow({ label, value, mono, small }: DiagRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "break-all text-right text-sm font-medium text-foreground",
          mono && "font-mono text-xs font-normal",
          small && "text-[11px] font-normal"
        )}
      >
        {value}
      </span>
    </div>
  );
}
