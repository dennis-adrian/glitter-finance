// What the "Sincronización" card in Más tells a vendor about this device's
// sync, in plain words, from the shared sync status (sync-status.ts). The
// pill names the state; this explains what it means for their sales and
// whether "Sincronizar ahora" can help.

import { relativeTime } from "@/lib/dates";
import { countLabel } from "@/lib/plural";
import type { SyncStatusSnapshot } from "@/lib/powersync/sync-status";

export type SyncSummary = {
  /** One line on where the device stands. */
  headline: string;
  /** What that means for the vendor, when it needs saying. */
  detail: string | null;
  /** "Última sincronización: hace 4 min", or that this device never synced. */
  lastSynced: string;
  /** Whether reconnecting can change anything. */
  canSyncNow: boolean;
};

/**
 * The sync service is at its connection limit and refused this device
 * (PSYNC_S2304 over a WebSocket, HTTP 429 over a stream). The device retries
 * by itself, and its own writes still upload meanwhile: only receiving other
 * devices' changes waits.
 */
export function isWaitingForSyncSlot(downloadError: string | null): boolean {
  if (!downloadError) return false;
  return /PSYNC_S2304|\b429\b|Too Many Requests/i.test(downloadError);
}

function lastSyncedLabel(lastSyncedAt: Date | null, now: number) {
  if (!lastSyncedAt) return "Este dispositivo todavía no se sincronizó";
  const when = relativeTime(lastSyncedAt.toISOString(), now);
  return `Última sincronización: ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
}

function pendingDetail(pendingCount: number) {
  return pendingCount > 0
    ? `${countLabel(pendingCount, "cambio pendiente", "cambios pendientes")} de subir.`
    : null;
}

export function summarizeSync(
  status: Pick<
    SyncStatusSnapshot,
    "state" | "lastSyncedAt" | "pendingCount" | "downloadError"
  >,
  now = Date.now()
): SyncSummary {
  const lastSynced = lastSyncedLabel(status.lastSyncedAt, now);
  switch (status.state) {
    case "initializing":
      return {
        headline: "Conectando con la nube…",
        detail: null,
        lastSynced,
        canSyncNow: false,
      };
    case "synced":
      return {
        headline: "Todo está al día",
        detail: null,
        lastSynced,
        canSyncNow: true,
      };
    case "syncing":
      return {
        headline: "Sincronizando…",
        detail: pendingDetail(status.pendingCount),
        lastSynced,
        canSyncNow: true,
      };
    case "offline":
      if (isWaitingForSyncSlot(status.downloadError)) {
        return {
          headline: "Esperando turno para sincronizar",
          detail:
            "Hay muchos dispositivos conectados en este momento. Tus ventas se suben a la nube igual; los cambios hechos en otros dispositivos van a llegar en un momento, sin que hagas nada.",
          lastSynced,
          canSyncNow: true,
        };
      }
      return {
        headline: "Sin conexión con la nube",
        detail:
          "Podés seguir vendiendo: todo se guarda en este dispositivo y se sube cuando vuelva la conexión.",
        lastSynced,
        canSyncNow: true,
      };
    case "held":
      return {
        headline: "La hora de este dispositivo está adelantada",
        detail:
          "Tus cambios quedan guardados y se suben cuando la nube los acepte. Corregí la hora del dispositivo para que no vuelva a pasar.",
        lastSynced,
        canSyncNow: true,
      };
    case "tenant-changed":
      return {
        headline: "Tu puesto activo cambió en otro dispositivo",
        detail: "Recargá la app para seguir sincronizando.",
        lastSynced,
        canSyncNow: false,
      };
    case "blocked":
      return {
        headline: "Hay cambios que no llegaron a la nube",
        detail: "Abrí Diagnósticos desde Ajustes para revisarlos.",
        lastSynced,
        canSyncNow: true,
      };
  }
}
