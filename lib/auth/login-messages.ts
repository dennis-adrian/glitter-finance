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
  auth_link_other_browser:
    "No se pudo terminar el inicio de sesión en este navegador. Si abriste el enlace para confirmar tu correo, ya está confirmado: iniciá sesión con tu contraseña.",
  account_preparation_failed: "No se pudo preparar la cuenta.",
  email_link_invalid:
    "El enlace no es válido o ya venció. Si ya confirmaste tu correo, iniciá sesión con tu contraseña.",
  password_reset_link_invalid:
    "El enlace para cambiar la contraseña no es válido o ya venció. Pedí uno nuevo.",
} as const;

export const LOGIN_STATUS_MESSAGES = {
  signup_check_email:
    "Cuenta creada. Revisa tu correo electrónico para confirmarla y luego inicia sesión.",
  email_confirmed:
    "Tu correo está confirmado. Iniciá sesión con tu contraseña.",
  // The same text whether or not the account exists, so the form does not
  // tell anyone which emails have an account.
  password_reset_requested:
    "Si existe una cuenta con ese correo, te enviamos un enlace para crear una contraseña nueva. Revisá también la carpeta de spam.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;
export type LoginStatusCode = keyof typeof LOGIN_STATUS_MESSAGES;

/** The /login screens a redirect can open (the default is the welcome). */
export type LoginMode = "signin" | "signup" | "reset";

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
