// The only texts /login shows in its banners. Redirects to /login carry one
// of these codes in ?error= or ?message=, never the text itself, so a crafted
// link cannot put its own words in a trusted-looking alert on this domain.
// The page ignores any code it does not know.

export const LOGIN_ERROR_MESSAGES = {
  auth_callback_failed:
    "No se pudo completar el inicio de sesión. Intentá de nuevo.",
  google_sign_in_failed:
    "No se pudo iniciar sesión con Google. Intentá de nuevo.",
  google_origin_unavailable:
    "No se pudo determinar la URL de la app para iniciar sesión con Google.",
  account_preparation_failed: "No se pudo preparar la cuenta.",
} as const;

export const LOGIN_STATUS_MESSAGES = {
  signup_check_email:
    "Cuenta creada. Revisa tu correo electrónico para confirmarla y luego inicia sesión.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;
export type LoginStatusCode = keyof typeof LOGIN_STATUS_MESSAGES;

function lookup<Code extends string>(
  messages: Readonly<Record<Code, string>>,
  code: string | undefined
): string | null {
  return code && Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code as Code]
    : null;
}

export function loginErrorMessage(code: string | undefined): string | null {
  return lookup(LOGIN_ERROR_MESSAGES, code);
}

export function loginStatusMessage(code: string | undefined): string | null {
  return lookup(LOGIN_STATUS_MESSAGES, code);
}
