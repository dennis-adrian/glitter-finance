import type { SyncState } from "@/lib/powersync/sync-status";
import {
  describeUploadHold,
  type UploadHold,
} from "@/lib/powersync/upload-holds";

/**
 * Why an action that clears the local data (sign-out, switching, creating or
 * joining a tenant) must wait. Clearing empties the upload queue, so it is only
 * allowed once the device is fully synced with nothing left to upload. After
 * the active tenant changed on another device the device never syncs again
 * until it reloads, so it says to reload instead of to wait.
 */
export type LocalDataChangeBlocker =
  | "sync-failures"
  | "tenant-changed"
  | "pending-uploads"
  | "not-synced";

export function getLocalDataChangeBlocker(input: {
  powerSyncConfigured: boolean;
  syncState: SyncState;
  pendingCount: number;
  failureCount: number;
}): LocalDataChangeBlocker | null {
  if (!input.powerSyncConfigured) {
    return null;
  }
  if (input.failureCount > 0 || input.syncState === "blocked") {
    return "sync-failures";
  }
  // Ahead of pending uploads: the reload uploads them before it moves the
  // device to the active tenant.
  if (input.syncState === "tenant-changed") {
    return "tenant-changed";
  }
  if (input.pendingCount > 0) {
    return "pending-uploads";
  }
  if (input.syncState !== "synced") {
    return "not-synced";
  }
  return null;
}

export function describePendingUploads(count: number) {
  return count === 1
    ? "Hay 1 operación sin subir a la nube."
    : `Hay ${count} operaciones sin subir a la nube.`;
}

/** `action` completes "antes de …", e.g. "cerrar sesión". */
export function tenantChangedBlockerMessage(action: string) {
  return `Tu puesto activo cambió en otro dispositivo. Recargá la app antes de ${action}.`;
}

/**
 * `action` completes "antes de …", e.g. "cerrar sesión". With an upload hold
 * the wait is not about the connection, so the message says what it is.
 */
export function pendingUploadsBlockerMessage(
  count: number,
  action: string,
  uploadHold: Pick<UploadHold, "heldUntil"> | null = null
) {
  if (uploadHold) {
    const wait = count === 1 ? "Esperá a que se suba" : "Esperá a que se suban";
    return `${describePendingUploads(count)} ${describeUploadHold(uploadHold)} ${wait} antes de ${action}.`;
  }
  const wait =
    count === 1
      ? "Conectate y esperá a que se sincronice"
      : "Conectate y esperá a que se sincronicen";
  return `${describePendingUploads(count)} ${wait} antes de ${action}.`;
}

/**
 * Why an action that clears the local data must wait, for screens that do not
 * word it themselves. `action` completes "antes de …", e.g. "salir del
 * puesto".
 */
export function describeLocalDataChangeBlocker(
  blocker: LocalDataChangeBlocker,
  input: {
    pendingCount: number;
    uploadHold: Pick<UploadHold, "heldUntil"> | null;
    action: string;
  }
) {
  switch (blocker) {
    case "sync-failures":
      return `Hay operaciones que no llegaron a la nube. Abrí Diagnósticos, copiá el diagnóstico y resolvelas antes de ${input.action}.`;
    case "tenant-changed":
      return tenantChangedBlockerMessage(input.action);
    case "pending-uploads":
      return pendingUploadsBlockerMessage(
        input.pendingCount,
        input.action,
        input.uploadHold
      );
    case "not-synced":
      return `Esperá a que termine la sincronización antes de ${input.action}.`;
  }
}
