import { resolveAuthRedirectPath } from "@/lib/auth/oauth";
import { weakPasswordMessage } from "@/lib/auth/signup-error";

// Password reset: /login?mode=reset asks for the email, the recovery email
// links to /auth/confirm (type=recovery), and that sends the now signed-in
// user to the form at UPDATE_PASSWORD_PATH.

export const UPDATE_PASSWORD_PATH = "/auth/update-password";

export const PASSWORD_RESET_ORIGIN_UNAVAILABLE_MESSAGE =
  "No se pudo determinar la URL pública de la app. Configura NEXT_PUBLIC_APP_URL o APP_URL en el servidor para recuperar contraseñas.";

export const PASSWORD_UPDATE_FALLBACK_MESSAGE =
  "No se pudo guardar la contraseña. Intentá de nuevo.";

export function isUpdatePasswordPath(path: string): boolean {
  // Any base works here: only the path is read.
  return new URL(path, "http://localhost").pathname === UPDATE_PASSWORD_PATH;
}

/** The password form, continuing to `next` once the password is saved. */
export function buildUpdatePasswordPath(next: string): string {
  return next === "/" || isUpdatePasswordPath(next)
    ? UPDATE_PASSWORD_PATH
    : `${UPDATE_PASSWORD_PATH}?next=${encodeURIComponent(next)}`;
}

/** Where the password form continues to, never back to itself. */
export function resolvePasswordUpdateNext(
  nextRaw: string | null,
  origin: string
): string {
  const next = resolveAuthRedirectPath(nextRaw, origin);
  return isUpdatePasswordPath(next) ? "/" : next;
}

/**
 * `path`, or where the password form would continue to when `path` is the
 * form. For redirects to /login: signing in must not land on the form.
 */
export function skipPasswordForm(path: string, origin: string): string {
  return isUpdatePasswordPath(path)
    ? resolvePasswordUpdateNext(
        new URL(path, "http://localhost").searchParams.get("next"),
        origin
      )
    : path;
}

type PasswordUpdateAuthError = {
  code?: string | null;
  name?: string | null;
  reasons?: unknown;
  status?: number | null;
};

/**
 * The recovery session is gone (expired, signed out elsewhere, or the page
 * was opened without one): only a new email can help.
 */
export function isPasswordResetSessionError(
  error: PasswordUpdateAuthError
): boolean {
  return (
    error.name === "AuthSessionMissingError" ||
    error.status === 401 ||
    error.code === "session_not_found" ||
    error.code === "session_expired" ||
    error.code === "refresh_token_not_found"
  );
}

export function getPasswordUpdateErrorMessage(
  error: PasswordUpdateAuthError
): string {
  if (error.code === "weak_password") {
    return weakPasswordMessage(error.reasons);
  }
  if (error.code === "same_password") {
    return "La contraseña nueva tiene que ser distinta de la anterior.";
  }
  if (error.status === 429) {
    return "Demasiados intentos. Esperá unos minutos antes de volver a intentar.";
  }
  if (error.name === "AuthRetryableFetchError") {
    return "No se pudo conectar con el servicio de inicio de sesión. Revisá tu conexión e intentá de nuevo.";
  }
  return PASSWORD_UPDATE_FALLBACK_MESSAGE;
}
