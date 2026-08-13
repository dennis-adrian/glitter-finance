import assert from "node:assert/strict";
import test from "node:test";
import {
  getSignUpErrorMessage,
  SIGN_UP_TEMPORARY_ERROR_MESSAGE,
} from "@/lib/auth/signup-error";

test("maps common signup errors to actionable Spanish messages", () => {
  assert.equal(
    getSignUpErrorMessage({ code: "user_already_exists" }),
    "Ya existe una cuenta con ese correo electrónico. Iniciá sesión o usá otro correo."
  );
  assert.equal(
    getSignUpErrorMessage({ code: "email_address_invalid" }),
    "Ingresá una dirección de correo electrónico válida."
  );
  assert.equal(
    getSignUpErrorMessage({ code: "signup_disabled" }),
    "La creación de cuentas no está disponible en este momento. Intentá de nuevo más tarde."
  );
  assert.equal(
    getSignUpErrorMessage({ code: "captcha_failed" }),
    "No se pudo completar la verificación de seguridad. Recargá la página e intentá de nuevo."
  );
});

test("explains each weak-password reason", () => {
  assert.equal(
    getSignUpErrorMessage({
      code: "weak_password",
      reasons: ["length", "characters", "pwned"],
    }),
    "La contraseña no cumple los requisitos de seguridad. Usá una contraseña más larga. Combiná mayúsculas, minúsculas, números y símbolos. Esta contraseña apareció en una filtración de datos; elegí otra."
  );
});

test("uses status and error type fallbacks for transient failures", () => {
  assert.equal(
    getSignUpErrorMessage({ code: "future_rate_limit", status: 429 }),
    "Demasiados intentos de registro. Esperá unos minutos antes de volver a intentar."
  );
  assert.equal(
    getSignUpErrorMessage({ name: "AuthRetryableFetchError" }),
    "No se pudo conectar con el servicio de registro. Revisá tu conexión e intentá de nuevo."
  );
  assert.equal(
    getSignUpErrorMessage({ status: 503 }),
    SIGN_UP_TEMPORARY_ERROR_MESSAGE
  );
});

test("does not expose unknown backend messages", () => {
  const backendError = {
    code: "future_error",
    message: "Internal detail that must not reach the user",
  };

  assert.equal(
    getSignUpErrorMessage(backendError),
    "No se pudo crear la cuenta. Intentá de nuevo o contactá a soporte si el problema continúa."
  );
});
