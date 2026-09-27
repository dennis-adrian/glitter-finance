"use client";

import { createClient } from "@/lib/supabase/client";

export const LOCAL_TEARDOWN_UNAVAILABLE_MESSAGE =
  "La limpieza local aún no está disponible.";
export const SESSION_REFRESH_FAILED_MESSAGE =
  "La sesión no se actualizó. Cierra sesión y vuelve a entrar, o recarga la página.";
export const SIGN_OUT_FAILED_MESSAGE =
  "No se pudo cerrar la sesión. Revisa tu conexión y vuelve a intentarlo.";

/**
 * Runs an account change (sign-out, or switching, creating or joining a
 * tenant) in the only safe order:
 *
 * 1. The local teardown. It refuses before any destructive step while the
 *    device holds unsynced work, and its errors are thrown to the caller,
 *    whose screen is still mounted because nothing was cleared.
 * 2. The server-side step, never started unless the teardown resolved.
 * 3. A full document navigation, so the next identity starts from a fresh
 *    page and provider rather than from the cleared one.
 *
 * Once step 1 resolved, the local data is gone and the provider shows its
 * progress panel instead of the app, so a failed server step goes to
 * `reportFailure` instead of being thrown. Resolves true while navigating.
 */
export async function changeIdentityAfterLocalTeardown(input: {
  teardown: () => Promise<void>;
  commit: () => Promise<void>;
  destination: string;
  failureMessage: string;
  reportFailure: (message: string) => void;
  navigate?: (destination: string) => void;
}): Promise<boolean> {
  await input.teardown();

  try {
    await input.commit();
  } catch (error) {
    console.error("[identity-change] server step failed", error);
    input.reportFailure(
      error instanceof Error && error.message
        ? error.message
        : input.failureMessage
    );
    return false;
  }

  (input.navigate ?? loadDocument)(input.destination);
  return true;
}

/**
 * A full load on purpose: the provider must start over for the new identity
 * and must not keep the cleared PowerSync instance of the previous one.
 */
export function loadDocument(destination: string) {
  window.location.assign(destination);
}

/** The new tenant claim only reaches the browser with a refreshed JWT. */
export async function refreshSessionForActiveTenant() {
  let failure: unknown = null;
  try {
    const { error } = await createClient().auth.refreshSession();
    failure = error;
  } catch (error) {
    failure = error;
  }
  if (failure) {
    console.error("[tenant-change] refreshSession failed", failure);
    throw new Error(SESSION_REFRESH_FAILED_MESSAGE, { cause: failure });
  }
}
