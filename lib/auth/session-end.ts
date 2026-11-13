// A device whose Supabase session ended while the app was open: its refresh
// token was revoked (the account was deleted, or other sessions were signed
// out by a password change, on another device) or the session ran out. The
// browser client then drops the session and emits SIGNED_OUT; a refresh that
// fails for lack of a connection keeps the session and emits nothing.
//
// Without a session nothing can tell those causes apart: a request without
// one runs as anon, which RLS shows no rows. So this is never treated as a
// removal from the puesto (lib/powersync/tenant-access.ts). It only stops the
// app and says what happens to the work this device has not uploaded.
// PowerSyncProvider shows it (components/providers/session-ended-panel.tsx).

import { describePendingUploads } from "@/lib/powersync/local-data-gate";

/** The work the device holds, or null when it could not be read. */
export type SessionEndedWork = {
  pendingUploadCount: number;
  unresolvedFailureCount: number;
} | null;

/**
 * Whether an auth event means the session is gone. Only SIGNED_OUT: the
 * client emits it when a refresh is refused for good, and when another tab
 * of this browser signs out.
 */
export function isSessionEndEvent(event: string): boolean {
  return event === "SIGNED_OUT";
}

/** True unless the device is known to hold nothing unsynced. */
export function sessionEndedWithWork(work: SessionEndedWork): boolean {
  return (
    work === null ||
    work.pendingUploadCount > 0 ||
    work.unresolvedFailureCount > 0
  );
}

const CAUSES =
  "Puede que hayas eliminado tu cuenta o cambiado la contraseña desde otro dispositivo, o que la sesión haya vencido.";

export function sessionEndedCopy(work: SessionEndedWork): {
  message: string;
  detail: string;
} {
  const message = "Tu sesión terminó.";
  if (!sessionEndedWithWork(work)) {
    return { message, detail: `${CAUSES} Iniciá sesión de nuevo para seguir.` };
  }
  const what =
    work === null
      ? "No se pudo comprobar si quedaron operaciones sin subir en este dispositivo."
      : work.pendingUploadCount > 0
        ? describePendingUploads(work.pendingUploadCount)
        : "Hay operaciones que la nube rechazó y siguen en este dispositivo.";
  return {
    message,
    detail: `${CAUSES} ${what} Si volvés a iniciar sesión con la misma cuenta, se suben solas. Si tu cuenta ya no existe, no se van a poder subir: descargá una copia y descartalas.`,
  };
}
