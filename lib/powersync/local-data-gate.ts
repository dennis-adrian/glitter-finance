import type { SyncState } from "@/lib/powersync/use-sync-status";

/**
 * Why an action that clears the local data (sign-out, switching, creating or
 * joining a tenant) must wait. Clearing empties the upload queue, so it is only
 * allowed once the device is fully synced with nothing left to upload.
 */
export type LocalDataChangeBlocker =
  | "sync-failures"
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
export function pendingUploadsBlockerMessage(count: number, action: string) {
  const wait =
    count === 1
      ? "Conéctate y espera a que se sincronice"
      : "Conéctate y espera a que se sincronicen";
  return `${describePendingUploads(count)} ${wait} antes de ${action}.`;
}
