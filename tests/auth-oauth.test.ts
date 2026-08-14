import assert from "node:assert/strict";
import test from "node:test";
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
      { error: "No se pudo iniciar sesión." },
      "/join/invite-123"
    ),
    "/login?error=No+se+pudo+iniciar+sesi%C3%B3n.&next=%2Fjoin%2Finvite-123"
  );
});
