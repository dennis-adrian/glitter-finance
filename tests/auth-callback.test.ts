// app/auth/callback: Google sign-in and emails that use Supabase's default
// link land here with a code. Wherever it redirects must stay on this site.

import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthError,
  AuthPKCECodeVerifierMissingError,
} from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { stubModule } from "./support/stub-module";

let exchange: (code: string) => Promise<{ error: AuthError | null }>;
const exchangedCodes: string[] = [];

stubModule("@/lib/supabase/server", {
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: (code: string) => {
        exchangedCodes.push(code);
        return exchange(code);
      },
    },
  }),
});

const ORIGIN = "https://pos.example.com";

async function callback(query: string) {
  const { GET } = await import("@/app/auth/callback/route");
  exchangedCodes.length = 0;
  const response = await GET(
    new Request(`${ORIGIN}/auth/callback${query}`) as NextRequest
  );
  const location = response.headers.get("location") ?? "";
  const url = new URL(location);
  return {
    status: response.status,
    origin: url.origin,
    path: `${url.pathname}${url.search}`,
  };
}

// The route logs every failure; keep the test output readable.
test.beforeEach(() => {
  test.mock.method(console, "error", () => {});
  exchange = async () => ({ error: null });
});
test.afterEach(() => test.mock.restoreAll());

test("a successful exchange continues to the requested page", async () => {
  const result = await callback("?code=abc&next=%2Fjoin%2Finvite-1");
  assert.equal(result.origin, ORIGIN);
  assert.equal(result.path, "/join/invite-1");
  assert.deepEqual(exchangedCodes, ["abc"]);
});

test("a next that leaves the site is replaced by the home page", async () => {
  for (const next of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/.//evil.example",
    "/%2e%2e//evil.example",
  ]) {
    const result = await callback(`?code=abc&next=${encodeURIComponent(next)}`);
    assert.equal(result.origin, ORIGIN, next);
    assert.equal(result.path, "/", next);
  }
});

test("a provider error goes back to login, keeping a safe next", async () => {
  const result = await callback("?error=access_denied&next=%2Fjoin%2Finvite-1");
  assert.equal(result.origin, ORIGIN);
  assert.equal(
    result.path,
    "/login?error=auth_callback_failed&next=%2Fjoin%2Finvite-1"
  );
  assert.deepEqual(exchangedCodes, []);

  const unsafe = await callback("?error=access_denied&next=%2F%2Fevil.example");
  assert.equal(unsafe.path, "/login?error=auth_callback_failed");
});

test("a failed exchange says why and never signs in", async () => {
  exchange = async () => ({
    error: new AuthError("Invalid code", 400, "bad_code"),
  });
  assert.equal(
    (await callback("?code=abc")).path,
    "/login?error=auth_callback_failed"
  );

  // An email link opened in another browser has no PKCE verifier.
  exchange = async () => ({ error: new AuthPKCECodeVerifierMissingError() });
  assert.equal(
    (await callback("?code=abc")).path,
    "/login?error=auth_link_other_browser"
  );

  exchange = async () => {
    throw new Error("network down");
  };
  assert.equal(
    (await callback("?code=abc")).path,
    "/login?error=auth_callback_failed"
  );
});

test("a failed recovery link asks for a new reset email", async () => {
  exchange = async () => ({
    error: new AuthError("Invalid code", 400, "bad_code"),
  });
  const result = await callback("?code=abc&next=%2Fauth%2Fupdate-password");
  assert.equal(
    result.path,
    "/login?mode=reset&error=password_reset_link_invalid"
  );
});
