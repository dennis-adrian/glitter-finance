type SignUpAuthError = {
  code?: string | null;
  name?: string | null;
  reasons?: unknown;
  status?: number | null;
};

export const SIGN_UP_TEMPORARY_ERROR_MESSAGE =
  "El servicio de registro tiene un problema temporal. Intentá de nuevo en unos minutos.";

export const SIGN_UP_FALLBACK_ERROR_MESSAGE =
  "No se pudo crear la cuenta. Intentá de nuevo o contactá a soporte si el problema continúa.";

const SIGN_UP_RATE_LIMIT_ERROR_MESSAGE =
  "Demasiados intentos de registro. Esperá unos minutos antes de volver a intentar.";

const SIGN_UP_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  email_exists:
    "Ya existe una cuenta con ese correo electrónico. Iniciá sesión o usá otro correo.",
  user_already_exists:
    "Ya existe una cuenta con ese correo electrónico. Iniciá sesión o usá otro correo.",
  identity_already_exists:
    "Ya existe una cuenta con ese correo electrónico. Iniciá sesión o usá otro correo.",
  email_address_invalid: "Ingresá una dirección de correo electrónico válida.",
  email_address_not_authorized:
    "Este correo electrónico no está autorizado para crear una cuenta.",
  validation_failed:
    "Revisá el correo electrónico y la contraseña e intentá de nuevo.",
  signup_disabled:
    "La creación de cuentas no está disponible en este momento. Intentá de nuevo más tarde.",
  email_provider_disabled:
    "El registro con correo electrónico no está disponible en este momento.",
  provider_disabled:
    "El registro con correo electrónico no está disponible en este momento.",
  captcha_failed:
    "No se pudo completar la verificación de seguridad. Recargá la página e intentá de nuevo.",
  over_request_rate_limit: SIGN_UP_RATE_LIMIT_ERROR_MESSAGE,
  over_email_send_rate_limit: SIGN_UP_RATE_LIMIT_ERROR_MESSAGE,
  email_send_failed:
    "No se pudo enviar el correo de confirmación. Intentá de nuevo en unos minutos.",
  request_timeout: SIGN_UP_TEMPORARY_ERROR_MESSAGE,
  hook_timeout: SIGN_UP_TEMPORARY_ERROR_MESSAGE,
  hook_timeout_after_retry: SIGN_UP_TEMPORARY_ERROR_MESSAGE,
  hook_payload_over_size_limit: SIGN_UP_TEMPORARY_ERROR_MESSAGE,
  hook_payload_invalid_content_type: SIGN_UP_TEMPORARY_ERROR_MESSAGE,
  unexpected_failure: SIGN_UP_TEMPORARY_ERROR_MESSAGE,
};

function weakPasswordMessage(reasons: unknown): string {
  if (!Array.isArray(reasons)) {
    return "La contraseña no cumple los requisitos de seguridad. Usá una más larga y combiná letras, números y símbolos.";
  }

  const guidance: string[] = [];
  if (reasons.includes("length")) {
    guidance.push("Usá una contraseña más larga.");
  }
  if (reasons.includes("characters")) {
    guidance.push("Combiná mayúsculas, minúsculas, números y símbolos.");
  }
  if (reasons.includes("pwned")) {
    guidance.push(
      "Esta contraseña apareció en una filtración de datos; elegí otra."
    );
  }

  return guidance.length > 0
    ? `La contraseña no cumple los requisitos de seguridad. ${guidance.join(" ")}`
    : "La contraseña no cumple los requisitos de seguridad. Elegí otra contraseña.";
}

export function getSignUpErrorMessage(error: SignUpAuthError): string {
  if (error.code === "weak_password") {
    return weakPasswordMessage(error.reasons);
  }

  if (
    error.code &&
    Object.prototype.hasOwnProperty.call(SIGN_UP_ERROR_MESSAGES, error.code)
  ) {
    return SIGN_UP_ERROR_MESSAGES[error.code];
  }

  if (error.status === 429) {
    return SIGN_UP_RATE_LIMIT_ERROR_MESSAGE;
  }

  if (error.name === "AuthRetryableFetchError") {
    return "No se pudo conectar con el servicio de registro. Revisá tu conexión e intentá de nuevo.";
  }

  if (error.status && error.status >= 500) {
    return SIGN_UP_TEMPORARY_ERROR_MESSAGE;
  }

  return SIGN_UP_FALLBACK_ERROR_MESSAGE;
}
