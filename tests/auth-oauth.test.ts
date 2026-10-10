import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_ERROR_MESSAGES,
  LOGIN_STATUS_MESSAGES,
  loginErrorMessage,
  loginStatusMessage,
} from "@/lib/auth/login-messages";
import {
  buildAuthCallbackUrl,
  buildLoginRedirectPath,
  resolveAuthRedirectPath,
} from "@/lib/auth/oauth";

test("builds an OAuth callback and preserves a safe next path", () => {
  assert.equal(
    buildAuthCallbackUrl("http://127.0.0.1:3000/", "/join/invite-123"),
    "http://127.0.0.1:3000/auth/callback?next=%2Fjoin%2Finvite-123"
  );
  assert.equal(
    buildAuthCallbackUrl("https://pos.example.com", "/"),
    "https://pos.example.com/auth/callback"
  );
  assert.equal(buildAuthCallbackUrl("", "/"), null);
  assert.equal(buildAuthCallbackUrl("javascript:alert(1)", "/"), null);
});

test("rejects origins containing URL components beyond the root origin", () => {
  assert.equal(
    buildAuthCallbackUrl("https://pos.example.com?tenant=other", "/"),
    null
  );
  assert.equal(
    buildAuthCallbackUrl("https://pos.example.com#callback", "/"),
    null
  );
  assert.equal(
    buildAuthCallbackUrl("https://pos.example.com/nested", "/"),
    null
  );
  assert.equal(
    buildAuthCallbackUrl("https://user:secret@pos.example.com", "/"),
    null
  );
});

test("rejects external and protocol-relative post-auth redirects", () => {
  assert.equal(
    resolveAuthRedirectPath("/sales?range=today", "http://localhost:3000"),
    "/sales?range=today"
  );
  assert.equal(
    resolveAuthRedirectPath("https://evil.example", "http://localhost:3000"),
    "/"
  );
  assert.equal(
    resolveAuthRedirectPath("//evil.example", "http://localhost:3000"),
    "/"
  );
});

test("preserves next when returning an OAuth error to login", () => {
  assert.equal(
    buildLoginRedirectPath(
      { error: "google_sign_in_failed" },
      "/join/invite-123"
    ),
    "/login?error=google_sign_in_failed&next=%2Fjoin%2Finvite-123"
  );
  assert.equal(
    buildLoginRedirectPath({ message: "signup_check_email" }, "/"),
    "/login?message=signup_check_email"
  );
  assert.equal(buildLoginRedirectPath({}, "/"), "/login");
});

test("login banners show only known message codes", () => {
  assert.equal(
    loginErrorMessage("google_sign_in_failed"),
    LOGIN_ERROR_MESSAGES.google_sign_in_failed
  );
  assert.equal(
    loginStatusMessage("signup_check_email"),
    LOGIN_STATUS_MESSAGES.signup_check_email
  );
  for (const code of [
    undefined,
    "",
    "Tu cuenta fue suspendida. Llamá al 555-0100.",
    "toString",
    "__proto__",
    "signup_check_email ",
  ]) {
    assert.equal(loginErrorMessage(code), null, String(code));
    assert.equal(loginStatusMessage(code), null, String(code));
  }
  // An error code is not a status code and the other way around.
  assert.equal(loginStatusMessage("google_sign_in_failed"), null);
  assert.equal(loginErrorMessage("signup_check_email"), null);
});
