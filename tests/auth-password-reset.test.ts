import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmailLinkTemplate,
  parseEmailLinkType,
  resolveEmailLinkDestination,
  resolveEmailLinkNext,
} from "@/lib/auth/email-link";
import { buildAuthCallbackUrl, buildLoginRedirectPath } from "@/lib/auth/oauth";
import {
  buildUpdatePasswordPath,
  getPasswordUpdateErrorMessage,
  isPasswordResetSessionError,
  PASSWORD_UPDATE_FALLBACK_MESSAGE,
  resolvePasswordUpdateNext,
  skipPasswordForm,
  UPDATE_PASSWORD_PATH,
} from "@/lib/auth/password-reset";

const ORIGIN = "http://localhost:3000";

test("the password form carries where to go once it is saved", () => {
  assert.equal(buildUpdatePasswordPath("/"), UPDATE_PASSWORD_PATH);
  assert.equal(
    buildUpdatePasswordPath("/join/invite-123"),
    "/auth/update-password?next=%2Fjoin%2Finvite-123"
  );
  assert.equal(
    buildUpdatePasswordPath("/auth/update-password?next=%2Fsales"),
    UPDATE_PASSWORD_PATH
  );
});

test("the password form never continues to itself or off the site", () => {
  assert.equal(
    resolvePasswordUpdateNext("/join/invite-123", ORIGIN),
    "/join/invite-123"
  );
  assert.equal(resolvePasswordUpdateNext(UPDATE_PASSWORD_PATH, ORIGIN), "/");
  assert.equal(
    resolvePasswordUpdateNext("/auth/update-password?next=%2Fsales", ORIGIN),
    "/"
  );
  assert.equal(resolvePasswordUpdateNext("/.//evil.example", ORIGIN), "/");
  assert.equal(resolvePasswordUpdateNext(null, ORIGIN), "/");
});

test("a verified recovery link always opens the password form", () => {
  assert.equal(
    resolveEmailLinkDestination("recovery", "/", ORIGIN),
    UPDATE_PASSWORD_PATH
  );
  assert.equal(
    resolveEmailLinkDestination("recovery", "/join/invite-123", ORIGIN),
    "/auth/update-password?next=%2Fjoin%2Finvite-123"
  );
  assert.equal(
    resolveEmailLinkDestination(
      "recovery",
      "/auth/update-password?next=%2Fjoin%2Finvite-123",
      ORIGIN
    ),
    "/auth/update-password?next=%2Fjoin%2Finvite-123"
  );
});

test("the recovery email leads to the form, then to the original next", () => {
  // As requestPasswordReset builds it.
  const redirectTo = buildAuthCallbackUrl(
    ORIGIN,
    buildUpdatePasswordPath("/join/invite-123")
  );
  assert.ok(redirectTo);

  const link = new URL(
    buildEmailLinkTemplate("recovery")
      .replace("{{ .SiteURL }}", "http://127.0.0.1:3000")
      .replace("{{ .TokenHash }}", "pkce_0123abcd")
      .replace("{{ .RedirectTo }}", encodeURIComponent(redirectTo))
  );
  const type = parseEmailLinkType(link.searchParams.get("type"));
  assert.equal(type, "recovery");

  const destination = resolveEmailLinkDestination(
    "recovery",
    resolveEmailLinkNext(link.searchParams.get("next"), link.origin),
    link.origin
  );
  assert.equal(destination, "/auth/update-password?next=%2Fjoin%2Finvite-123");

  const formUrl = new URL(destination, link.origin);
  assert.equal(formUrl.pathname, UPDATE_PASSWORD_PATH);
  assert.equal(
    resolvePasswordUpdateNext(formUrl.searchParams.get("next"), ORIGIN),
    "/join/invite-123"
  );
});

test("a redirect to /login skips the password form but keeps its next", () => {
  assert.equal(
    skipPasswordForm("/auth/update-password?next=%2Fjoin%2Finvite-123", ORIGIN),
    "/join/invite-123"
  );
  assert.equal(skipPasswordForm(UPDATE_PASSWORD_PATH, ORIGIN), "/");
  assert.equal(
    skipPasswordForm("/auth/update-password?next=%2F%2Fevil.example", ORIGIN),
    "/"
  );
  assert.equal(
    skipPasswordForm("/join/invite-123", ORIGIN),
    "/join/invite-123"
  );
});

test("an expired recovery link reopens the reset screen with next", () => {
  assert.equal(
    buildLoginRedirectPath(
      { error: "password_reset_link_invalid", mode: "reset" },
      "/join/invite-123"
    ),
    "/login?mode=reset&error=password_reset_link_invalid&next=%2Fjoin%2Finvite-123"
  );
});

test("maps password update errors to Spanish messages", () => {
  assert.equal(
    getPasswordUpdateErrorMessage({ code: "same_password", status: 422 }),
    "La contraseña nueva tiene que ser distinta de la anterior."
  );
  assert.equal(
    getPasswordUpdateErrorMessage({
      code: "weak_password",
      reasons: ["pwned"],
    }),
    "La contraseña no cumple los requisitos de seguridad. Esta contraseña apareció en una filtración de datos; elegí otra."
  );
  assert.equal(
    getPasswordUpdateErrorMessage({
      code: "over_request_rate_limit",
      status: 429,
    }),
    "Demasiados intentos. Esperá unos minutos antes de volver a intentar."
  );
  assert.equal(
    getPasswordUpdateErrorMessage({ name: "AuthRetryableFetchError" }),
    "No se pudo conectar con el servicio de inicio de sesión. Revisá tu conexión e intentá de nuevo."
  );
  assert.equal(
    getPasswordUpdateErrorMessage({ code: "unexpected_failure", status: 500 }),
    PASSWORD_UPDATE_FALLBACK_MESSAGE
  );
});

test("a missing or expired session means asking for a new link", () => {
  assert.ok(
    isPasswordResetSessionError({
      name: "AuthSessionMissingError",
      status: 400,
    })
  );
  assert.ok(isPasswordResetSessionError({ code: "bad_jwt", status: 401 }));
  assert.ok(
    isPasswordResetSessionError({ code: "session_not_found", status: 403 })
  );
  assert.ok(
    !isPasswordResetSessionError({ code: "same_password", status: 422 })
  );
  assert.ok(!isPasswordResetSessionError({ name: "AuthRetryableFetchError" }));
});
