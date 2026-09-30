// app/auth/confirm: the links in the confirmation and recovery emails. A
// link works in any browser, so whoever holds one can open it in someone
// else's. Only a recovery link may sign the browser in; a confirmation link
// must leave its cookies, and any session in them, as they were.
//
// These run the real Supabase clients against a fake Auth server (fetch),
// so they check the cookies the route actually writes.

import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import { buildAuthCallbackUrl } from "@/lib/auth/oauth";
import { buildUpdatePasswordPath } from "@/lib/auth/password-reset";
import { stubModule, withEnv } from "./support/stub-module";

const ORIGIN = "https://pos.example.com";
const SUPABASE_URL = "https://project.supabase.example";
const SESSION_COOKIE = "sb-project-auth-token";

// The browser's cookies, as next/headers' cookies() hands them to
// lib/supabase/server.
let cookieJar = new Map<string, string>();
let cookieWrites: string[] = [];
stubModule("next/headers", {
  cookies: async () => ({
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      cookieWrites.push(name);
      cookieJar.set(name, value);
    },
  }),
});

type AuthRequest = {
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
};

let authRequests: AuthRequest[] = [];
let verifyStatus = 200;
let logoutStatus = 204;

function fakeJwt(payload: Record<string, unknown>) {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.signature`;
}

const LINK_ACCESS_TOKEN = fakeJwt({
  sub: "11111111-1111-4111-8111-111111111111",
  role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600,
});

function linkSession() {
  return {
    access_token: LINK_ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "link-refresh-token",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      aud: "authenticated",
      role: "authenticated",
      email: "owner-of-the-link@example.com",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-09-01T00:00:00Z",
    },
  };
}

async function fakeAuthServer(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url
  );
  const headers = new Headers(init?.headers);
  authRequests.push({
    path: `${url.pathname}${url.search}`,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    authorization: headers.get("authorization"),
  });

  if (url.origin !== SUPABASE_URL) {
    throw new Error(`Unexpected request to ${url.href}`);
  }
  if (url.pathname === "/auth/v1/verify") {
    return verifyStatus === 200
      ? Response.json(linkSession())
      : Response.json(
          {
            code: verifyStatus,
            error_code: "otp_expired",
            msg: "Token has expired or is invalid",
          },
          { status: verifyStatus }
        );
  }
  if (url.pathname === "/auth/v1/logout") {
    return new Response(null, { status: logoutStatus });
  }
  throw new Error(`Unexpected request to ${url.href}`);
}

async function confirm(query: Record<string, string>) {
  const { GET } = await import("@/app/auth/confirm/route");
  const response = await withEnv(
    [],
    {
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    },
    () =>
      GET(
        new Request(
          `${ORIGIN}/auth/confirm?${new URLSearchParams(query)}`
        ) as NextRequest
      )
  );
  const url = new URL(response.headers.get("location") ?? "");
  return {
    status: response.status,
    origin: url.origin,
    path: `${url.pathname}${url.search}`,
  };
}

// The redirect URL the app sends with sign-up and reset requests.
const CALLBACK_NEXT = `${ORIGIN}/auth/callback?next=%2Fjoin%2Finvite-1`;

test.beforeEach(() => {
  test.mock.method(console, "error", () => {});
  test.mock.method(globalThis, "fetch", fakeAuthServer);
  cookieJar = new Map([[SESSION_COOKIE, "the-browser-own-session"]]);
  cookieWrites = [];
  authRequests = [];
  verifyStatus = 200;
  logoutStatus = 204;
});
test.afterEach(() => test.mock.restoreAll());

test("a confirmation link confirms without signing this browser in", async () => {
  const result = await confirm({
    token_hash: "pkce_confirm",
    type: "email",
    next: CALLBACK_NEXT,
  });

  assert.equal(result.origin, ORIGIN);
  assert.equal(
    result.path,
    "/login?mode=signin&message=email_confirmed&next=%2Fjoin%2Finvite-1"
  );
  assert.deepEqual(authRequests[0]?.body, {
    type: "email",
    token_hash: "pkce_confirm",
    gotrue_meta_security: {},
  });
  // The browser's own session is untouched, and nothing new was written.
  assert.deepEqual(cookieWrites, []);
  assert.deepEqual(
    [...cookieJar],
    [[SESSION_COOKIE, "the-browser-own-session"]]
  );
  // The link's session is revoked, not handed to anyone.
  assert.equal(authRequests.length, 2);
  assert.equal(authRequests[1]?.path, "/auth/v1/logout?scope=local");
  assert.equal(authRequests[1]?.authorization, `Bearer ${LINK_ACCESS_TOKEN}`);
});

test("a confirmation stands when its session cannot be revoked", async () => {
  logoutStatus = 500;
  const result = await confirm({ token_hash: "pkce_confirm", type: "email" });
  assert.equal(result.path, "/login?mode=signin&message=email_confirmed");
  assert.deepEqual(cookieWrites, []);

  test.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url
    );
    if (url.pathname === "/auth/v1/logout") {
      throw new TypeError("fetch failed");
    }
    return fakeAuthServer(input);
  });
  const offline = await confirm({ token_hash: "pkce_confirm", type: "email" });
  assert.equal(offline.path, "/login?mode=signin&message=email_confirmed");
  assert.deepEqual(cookieWrites, []);
});

test("a recovery link signs in and opens the password form", async () => {
  cookieJar = new Map();
  const result = await confirm({
    token_hash: "pkce_recovery",
    type: "recovery",
    // As requestPasswordReset builds it.
    next: buildAuthCallbackUrl(
      ORIGIN,
      buildUpdatePasswordPath("/join/invite-1")
    )!,
  });

  assert.equal(result.origin, ORIGIN);
  assert.equal(result.path, "/auth/update-password?next=%2Fjoin%2Finvite-1");
  assert.deepEqual(authRequests[0]?.body, {
    type: "recovery",
    token_hash: "pkce_recovery",
    gotrue_meta_security: {},
  });
  assert.equal(authRequests.length, 1);
  assert.ok(
    cookieWrites.some((name) => name.startsWith(SESSION_COOKIE)),
    "the recovery session is stored in the browser's cookies"
  );
});

test("an expired link says so and leaves the browser's session", async () => {
  verifyStatus = 403;

  const confirmation = await confirm({
    token_hash: "pkce_old",
    type: "email",
    next: CALLBACK_NEXT,
  });
  assert.equal(
    confirmation.path,
    "/login?error=email_link_invalid&next=%2Fjoin%2Finvite-1"
  );

  const recovery = await confirm({
    token_hash: "pkce_old",
    type: "recovery",
    next: CALLBACK_NEXT,
  });
  assert.equal(
    recovery.path,
    "/login?mode=reset&error=password_reset_link_invalid&next=%2Fjoin%2Finvite-1"
  );

  assert.deepEqual(cookieWrites, []);
  assert.deepEqual(
    [...cookieJar],
    [[SESSION_COOKIE, "the-browser-own-session"]]
  );
});

test("link types no email sends are refused without verifying", async () => {
  for (const type of ["signup", "magiclink", "invite", "email_change", ""]) {
    const result = await confirm({ token_hash: "pkce_any", type });
    assert.equal(result.path, "/login?error=email_link_invalid", type);
  }
  const noToken = await confirm({ type: "email" });
  assert.equal(noToken.path, "/login?error=email_link_invalid");

  assert.deepEqual(authRequests, []);
  assert.deepEqual(cookieWrites, []);
});

test("a link's next never leaves the site", async () => {
  for (const next of [
    "https://evil.example//evil.example",
    "/.//evil.example",
    `${ORIGIN}/auth/callback?next=${encodeURIComponent("//evil.example")}`,
  ]) {
    const result = await confirm({
      token_hash: "pkce_confirm",
      type: "email",
      next,
    });
    assert.equal(result.origin, ORIGIN, next);
    assert.equal(
      result.path,
      "/login?mode=signin&message=email_confirmed",
      next
    );
  }
});
