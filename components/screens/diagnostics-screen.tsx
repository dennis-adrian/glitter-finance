"use client";

// Tester-only diagnostics screen. Surfaces what testers need to write a
// useful bug report — sync state, upload queue, identity, device info —
// plus a "Forzar sincronización" action that reconnects PowerSync (kicking
// the queue) and a "Copiar diagnóstico" action that dumps everything as
// JSON to the clipboard, or, when the clipboard fails, into a selectable text
// box with a download button. Per PRD §8 + §14.
//
// Each transaction the server permanently rejected is listed with its error
// and a confirmed "Descartar operación" action (lib/powersync/
// discard-sync-failure.ts), the way out when retrying cannot succeed.

import {
  AlertTriangle,
  ChevronLeft,
  RefreshCw,
  ClipboardCopy,
  Download,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { Header } from "@/components/atoms/header";
import { DiscardSyncFailureDialog } from "@/components/molecules/discard-sync-failure-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useOptionalPowerSyncDb,
  usePowerSyncControls,
} from "@/components/providers/powersync-provider";
import type { UserTenantContext } from "@/lib/auth/tenant-context";
import { formatDateInputInBolivia, formatDateTimeInBolivia } from "@/lib/dates";
import { reportClientFailure } from "@/lib/observability/report-client-failure";
import {
  discardSyncFailure,
  SyncFailureDiscardError,
} from "@/lib/powersync/discard-sync-failure";
import {
  describeSyncFailure,
  getDiscardedSyncFailures,
  getUnresolvedSyncFailures,
  type SyncFailure,
} from "@/lib/powersync/sync-failures";
import {
  useSyncStatus,
  useSyncStatusStore,
} from "@/lib/powersync/use-sync-status";

type QueueDetails = {
  pendingBytes: number | null;
  failures: SyncFailure[];
  discarded: SyncFailure[];
};

const emptyQueueDetails: QueueDetails = {
  pendingBytes: null,
  failures: [],
  discarded: [],
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

/** Saves the diagnostic as a file, for when the clipboard is unavailable. */
function downloadDiagnostic(json: string) {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" })
  );
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `diagnostico-${formatDateInputInBolivia()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Some browsers read the blob after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
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
  const sync = useSyncStatus();
  const syncStatusStore = useSyncStatusStore();
  const [queueDetails, setQueueDetails] = useState<{
    db: AbstractPowerSyncDatabase;
    details: QueueDetails;
  } | null>(null);
  const [device, setDevice] = useState<DeviceInfo>(readDeviceInfoSync);
  const [reconnecting, setReconnecting] = useState(false);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  // The diagnostic as text, shown when copying it failed.
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const copyFallbackRef = useRef<HTMLTextAreaElement | null>(null);
  const [discarding, setDiscarding] = useState<SyncFailure | null>(null);
  // Bumped after a discard, which does not always change the counts.
  const [detailsVersion, setDetailsVersion] = useState(0);
  const { pendingCount, failureCount } = sync;
  const details =
    queueDetails && queueDetails.db === db
      ? queueDetails.details
      : emptyQueueDetails;

  // The status itself is shared (useSyncStatus). The queue size and the
  // failure records are read again only when the counts change: summing the
  // queue reads every pending operation.
  useEffect(() => {
    if (!db) return;
    let cancelled = false;

    async function loadQueueDetails(activeDb: AbstractPowerSyncDatabase) {
      const [statsResult, failuresResult, discardedResult] =
        await Promise.allSettled([
          activeDb.getUploadQueueStats(true),
          getUnresolvedSyncFailures(activeDb),
          getDiscardedSyncFailures(activeDb),
        ]);
      if (cancelled) return;
      setQueueDetails((current) => {
        const previous =
          current?.db === activeDb ? current.details : emptyQueueDetails;
        return {
          db: activeDb,
          details: {
            pendingBytes:
              statsResult.status === "fulfilled"
                ? (statsResult.value.size ?? null)
                : previous.pendingBytes,
            // Keep the last list when the read fails, so the failures stay
            // on screen.
            failures:
              failuresResult.status === "fulfilled"
                ? failuresResult.value
                : previous.failures,
            discarded:
              discardedResult.status === "fulfilled"
                ? discardedResult.value
                : previous.discarded,
          },
        };
      });
    }

    void loadQueueDetails(db);
    return () => {
      cancelled = true;
    };
  }, [db, pendingCount, failureCount, detailsVersion]);

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

  // Select the fallback text so it can be copied by hand right away.
  useEffect(() => {
    const textarea = copyFallbackRef.current;
    if (!copyFallback || !textarea) return;
    textarea.focus();
    textarea.select();
  }, [copyFallback]);

  async function handleReconnect() {
    if (!controls || reconnecting) return;
    setReconnecting(true);
    try {
      await controls.reconnect();
    } catch (error) {
      console.error("[Diagnostics] reconnect failed", error);
      toast.error(
        "No se pudo reconectar. Revisa la conexión e inténtalo de nuevo."
      );
    } finally {
      setReconnecting(false);
    }
  }

  async function handleDiscard(failure: SyncFailure) {
    if (!db) {
      throw new Error("La base local no está disponible en este momento.");
    }
    try {
      await discardSyncFailure(db, failure.id);
    } catch (error) {
      if (error instanceof SyncFailureDiscardError) throw error;
      console.error("[Diagnostics] discard failed", error);
      reportClientFailure("powersync_sync_failure_discard", error);
      throw new Error("No se pudo descartar la operación. Inténtalo de nuevo.");
    } finally {
      setDetailsVersion((version) => version + 1);
      void syncStatusStore.refresh();
    }
    toast.success("Operación descartada");
  }

  async function handleCopy() {
    const payload = {
      generatedAt: new Date().toISOString(),
      sync: {
        connected: sync.connected,
        hasSynced: sync.hasSynced,
        lastSyncedAt: sync.lastSyncedAt?.toISOString() ?? null,
        uploading: sync.uploading,
        downloading: sync.downloading,
        uploadError: sync.uploadError,
        downloadError: sync.downloadError,
        pendingCount: sync.pendingCount,
        pendingBytes: details.pendingBytes,
        failures: details.failures,
        discardedFailures: details.discarded,
      },
      identity: {
        tenantId: tenantContext.tenant?.id ?? null,
        tenantName: tenantContext.tenant?.name ?? null,
        userId: tenantContext.user.id,
        displayName: tenantContext.user.displayName,
        email: tenantContext.user.email,
      },
      device,
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      // Undefined outside secure contexts; it can also reject (permission,
      // focus), and this copy is the recovery data for failed uploads.
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(json);
      setCopyFallback(null);
      setCopyConfirmed(true);
      window.setTimeout(() => setCopyConfirmed(false), 1800);
    } catch (error) {
      console.error("[Diagnostics] copy failed", error);
      setCopyFallback(json);
      toast.error(
        "No se pudo copiar el diagnóstico. Cópialo desde abajo o descárgalo."
      );
    }
  }

  function handleDownload(json: string) {
    try {
      downloadDiagnostic(json);
    } catch (error) {
      console.error("[Diagnostics] download failed", error);
      toast.error(
        "No se pudo descargar el diagnóstico. Selecciona el texto y cópialo."
      );
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

      {details.failures.length ? (
        <div
          className="mt-3 flex gap-2 rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4.25 shrink-0" />
          <span>
            {details.failures.length === 1
              ? "1 transacción no llegó a la nube."
              : `${details.failures.length} transacciones no llegaron a la nube.`}{" "}
            Copia este diagnóstico y no cierres sesión ni cambies de cuenta
            hasta {details.failures.length === 1 ? "resolverla" : "resolverlas"}
            : fuerza la sincronización cuando el problema esté corregido, o
            descarta la operación si la nube la sigue rechazando.
          </span>
        </div>
      ) : null}

      <DiagPanel title="Sincronización">
        <DiagRow label="Conectado" value={yesNo(sync.connected)} />
        <DiagRow label="Sincronizado" value={yesNo(sync.hasSynced)} />
        <DiagRow
          label="Última sincronización"
          value={
            sync.lastSyncedAt ? formatDateTimeInBolivia(sync.lastSyncedAt) : "—"
          }
        />
        <DiagRow label="Subiendo" value={yesNo(sync.uploading)} />
        <DiagRow label="Bajando" value={yesNo(sync.downloading)} />
        {sync.uploadError ? (
          <DiagRow label="Error de subida" value={sync.uploadError} mono />
        ) : null}
        {sync.downloadError ? (
          <DiagRow label="Error de bajada" value={sync.downloadError} mono />
        ) : null}
      </DiagPanel>

      <DiagPanel title="Cola de subida">
        <DiagRow
          label="Operaciones pendientes"
          value={String(sync.pendingCount)}
        />
        <DiagRow
          label="Tamaño aproximado"
          value={formatBytes(details.pendingBytes)}
        />
        <DiagRow
          label="Transacciones fallidas"
          value={String(sync.failureCount)}
        />
      </DiagPanel>

      {details.failures.length ? (
        <DiagPanel title="Transacciones fallidas">
          {details.failures.map((failure) => (
            <article
              key={failure.id}
              className="border-b border-border/60 py-2.5 first:pt-0 last:border-b-0 last:pb-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <strong className="text-sm font-semibold">
                  {describeSyncFailure(failure.operationsJson)}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {formatDateTimeInBolivia(failure.createdAt)}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                {failure.errorCode ? `${failure.errorCode} · ` : ""}
                {failure.errorMessage}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-destructive"
                onClick={() => setDiscarding(failure)}
                disabled={!db}
              >
                <Trash2 className="size-4" />
                Descartar operación
              </Button>
            </article>
          ))}
        </DiagPanel>
      ) : null}

      {details.discarded.length ? (
        <DiagPanel title="Operaciones descartadas">
          <p className="mb-1.5 text-xs leading-relaxed text-muted-foreground">
            Sus datos se guardan en este dispositivo, y en el diagnóstico, hasta
            que cierres sesión.
          </p>
          {details.discarded.map((failure) => (
            <DiagRow
              key={failure.id}
              label={describeSyncFailure(failure.operationsJson)}
              value={`${formatDateTimeInBolivia(failure.discardedAt ?? failure.createdAt)}${
                failure.errorCode ? ` · ${failure.errorCode}` : ""
              }`}
            />
          ))}
        </DiagPanel>
      ) : null}

      <DiagPanel title="Identidad">
        <DiagRow label="Cuenta" value={tenantContext.tenant?.id ?? "—"} mono />
        <DiagRow
          label="Nombre de la cuenta"
          value={tenantContext.tenant?.name ?? "—"}
        />
        <DiagRow label="Usuario" value={tenantContext.user.id} mono />
        <DiagRow label="Nombre" value={tenantContext.user.displayName} />
        <DiagRow
          label="Correo electrónico"
          value={tenantContext.user.email ?? "—"}
        />
      </DiagPanel>

      <DiagPanel title="Dispositivo">
        <DiagRow
          label="Conexión"
          value={device.online ? "En línea" : "Sin conexión"}
        />
        <DiagRow label="Modo PWA" value={yesNo(device.pwa)} />
        <DiagRow label="Pantalla" value={device.viewport} />
        <DiagRow label="Almacenamiento" value={device.storage} />
        <DiagRow
          label="Agente de usuario"
          value={device.userAgent}
          mono
          small
        />
      </DiagPanel>

      <div className="mt-4 grid gap-2.5">
        <Button
          size="lg"
          onClick={handleReconnect}
          disabled={!controls || reconnecting}
        >
          <RefreshCw className="size-4.5" />
          {reconnecting ? "Reconectando…" : "Forzar sincronización"}
        </Button>
        <Button variant="outline" size="lg" onClick={handleCopy}>
          <ClipboardCopy className="size-4.5" />
          {copyConfirmed ? "Copiado" : "Copiar diagnóstico"}
        </Button>
      </div>

      {copyFallback ? (
        <DiagPanel title="Diagnóstico">
          <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
            No se pudo copiar automáticamente. Selecciona todo el texto y
            cópialo, o descárgalo como archivo.
          </p>
          <Textarea
            ref={copyFallbackRef}
            readOnly
            value={copyFallback}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Diagnóstico en formato JSON"
            className="max-h-64 min-h-40 field-sizing-fixed font-mono text-xs md:text-xs"
          />
          <Button
            variant="outline"
            size="lg"
            className="mt-2.5 w-full"
            onClick={() => handleDownload(copyFallback)}
          >
            <Download className="size-4.5" />
            Descargar diagnóstico
          </Button>
        </DiagPanel>
      ) : null}

      <DiscardSyncFailureDialog
        label={
          discarding ? describeSyncFailure(discarding.operationsJson) : null
        }
        onClose={() => setDiscarding(null)}
        onConfirm={() =>
          discarding ? handleDiscard(discarding) : Promise.resolve()
        }
      />
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
