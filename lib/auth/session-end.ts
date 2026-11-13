// A device whose Supabase session ended while the app was open: its refresh
// token was revoked (the account was deleted, or other sessions were signed
// out by a password change, on another device), the session ran out, or the
// Auth server answered a refresh with an error supabase-js does not retry (a
// 500 or a 429 among them). The browser client then drops the session and
// emits SIGNED_OUT; a refresh that only lacked a connection (or got a 502 to
// 504) keeps it. The server can also clear the session cookies on a request
// of its own, with no event in the browser, so PowerSyncProvider also reads
// the session when the app is about to show, regains focus or comes back
// online, and when the PowerSync connector finds none.
//
// Without a session nothing can tell those causes apart: a request without
// one runs as anon, which RLS shows no rows. So this is never treated as a
// removal from the puesto (lib/powersync/tenant-access.ts). It stops the app
// and says what happens to the work this device has not uploaded; since the
// cause may be passing, the user can also keep recording, and the next check
// shows it again (components/providers/session-ended-panel.tsx).

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
  "Puede que hayas eliminado tu cuenta o cambiado la contraseña desde otro dispositivo, que la sesión haya vencido o que el servidor no la haya podido renovar.";

/** What signing in again does with the work, said truthfully. */
function afterSignIn(work: NonNullable<SessionEndedWork>) {
  return work.unresolvedFailureCount > 0
    ? "Si volvés a iniciar sesión con la misma cuenta, se sube lo que la nube acepte; lo que rechazó lo vas a ver en Diagnósticos."
    : "Si volvés a iniciar sesión con la misma cuenta, se suben solas.";
}

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
        ? work.unresolvedFailureCount > 0
          ? `${describePendingUploads(work.pendingUploadCount)} Algunas fueron rechazadas por la nube.`
          : describePendingUploads(work.pendingUploadCount)
        : "Hay operaciones que la nube rechazó y siguen en este dispositivo.";
  const after =
    work === null
      ? "Si volvés a iniciar sesión con la misma cuenta, se sube lo que quede pendiente."
      : afterSignIn(work);
  return {
    message,
    detail: `${CAUSES} ${what} ${after} Si tu cuenta ya no existe, no se van a poder subir: descargá una copia y descartalas desde acá antes de iniciar sesión, porque después ya no vas a poder.`,
  };
}
