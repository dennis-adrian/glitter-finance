// Captcha on the Supabase Auth calls anyone can make without a session
// (lib/auth/captcha.ts, app/auth/actions.ts). The forms post a Turnstile
// token; the actions hand it to Supabase Auth, which verifies it once captcha
// is enabled in the project. Without a token the requests are the same as
// before captcha existed, so environments without a site key keep working.
//
// The actions run the real Supabase client against a fake Auth server
// (fetch), so these check the request bodies Supabase Auth receives.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_TOKEN_FIELD,
  captchaOptions,
  getTurnstileSiteKey,
  isCaptchaError,
  isTurnstileUrl,
  readCaptchaToken,
  TURNSTILE_SCRIPT_URL,
} from "@/lib/auth/captcha";
import { getSignUpErrorMessage } from "@/lib/auth/signup-error";
import { stubModule, withEnv } from "./support/stub-module";

const ORIGIN = "https://pos.example.com";
const SUPABASE_URL = "https://project.supabase.example";

stubModule("next/headers", {
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => new Headers(),
});
stubModule("@/lib/auth/user-context", {
  ensureUserTenantContext: async () => {},
});

type AuthRequest = { path: string; body: Record<string, unknown> };
let authRequests: AuthRequest[] = [];
/** The error_code the fake server answers with; null answers success. */
let authErrorCode: string | null = null;

function fakeJwt(payload: Record<string, unknown>) {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.signature`;
}

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "vendedora@example.com",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-09-01T00:00:00Z",
};

function session() {
  return {
    access_token: fakeJwt({
      sub: USER.id,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresh-token",
    user: USER,
  };
}

async function fakeAuthServer(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url
  );
  if (url.origin !== SUPABASE_URL) {
    throw new Error(`Unexpected request to ${url.href}`);
  }
  authRequests.push({
    path: `${url.pathname}${url.search}`,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
  });

  if (authErrorCode) {
    return Response.json(
      {
        code: 400,
        error_code: authErrorCode,
        msg: "captcha protection: request disallowed (invalid-input-response)",
      },
      { status: 400 }
    );
  }
  if (url.pathname === "/auth/v1/token") return Response.json(session());
  if (url.pathname === "/auth/v1/signup") return Response.json(session());
  if (url.pathname === "/auth/v1/recover") return Response.json({});
  throw new Error(`Unexpected request to ${url.href}`);
}

function form(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
}

/** Runs an action; a redirect comes back as its target. */
async function run(
  action: (
    state: { error: string | null },
    formData: FormData
  ) => Promise<{ error: string | null }>,
  formData: FormData
): Promise<{ error: string | null } | { redirect: string }> {
  return withEnv(
    ["APP_URL", "VERCEL_ENV"],
    {
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_APP_URL: ORIGIN,
    },
    async () => {
      try {
        return await action({ error: null }, formData);
      } catch (error) {
        const digest = (error as { digest?: unknown }).digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          return { redirect: digest.split(";")[2] ?? "" };
        }
        throw error;
      }
    }
  );
}

test.beforeEach(() => {
  test.mock.method(console, "error", () => {});
  test.mock.method(globalThis, "fetch", fakeAuthServer);
  authRequests = [];
  authErrorCode = null;
});
test.afterEach(() => test.mock.restoreAll());

test("captcha is off unless a site key is configured", () => {
  assert.equal(getTurnstileSiteKey({}), null);
  assert.equal(
    getTurnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "  " }),
    null
  );
  assert.equal(
    getTurnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: " 0x4AAA " }),
    "0x4AAA"
  );
});

test("the token is read from the form, and only a plausible one", () => {
  assert.equal(readCaptchaToken(form({})), "");
  assert.equal(readCaptchaToken(form({ [CAPTCHA_TOKEN_FIELD]: "  " })), "");
  assert.equal(
    readCaptchaToken(form({ [CAPTCHA_TOKEN_FIELD]: "x".repeat(2049) })),
    ""
  );
  assert.equal(
    readCaptchaToken(form({ [CAPTCHA_TOKEN_FIELD]: " token-1 " })),
    "token-1"
  );
  const withFile = new FormData();
  withFile.set(CAPTCHA_TOKEN_FIELD, new Blob(["token"]));
  assert.equal(readCaptchaToken(withFile), "");
});

test("without a token the Supabase options carry no captcha", () => {
  assert.deepEqual(captchaOptions(""), {});
  assert.deepEqual(captchaOptions("token-1"), { captchaToken: "token-1" });
});

test("only Supabase's captcha_failed counts as a captcha error", () => {
  assert.equal(isCaptchaError({ code: "captcha_failed" }), true);
  assert.equal(isCaptchaError({ code: "invalid_credentials" }), false);
  assert.equal(isCaptchaError(null), false);
  assert.equal(
    getSignUpErrorMessage({ code: "captcha_failed" }),
    CAPTCHA_FAILED_MESSAGE
  );
});

test("the widget script is Cloudflare's own, rendered explicitly", () => {
  const url = new URL(TURNSTILE_SCRIPT_URL);
  assert.equal(url.origin, "https://challenges.cloudflare.com");
  assert.equal(url.searchParams.get("render"), "explicit");
  assert.equal(isTurnstileUrl(url), true);
  assert.equal(isTurnstileUrl(new URL(`${ORIGIN}/turnstile/v0/api.js`)), false);
  assert.equal(
    isTurnstileUrl(new URL("https://challenges.cloudflare.com.evil.example/")),
    false
  );
});

test("the service worker never caches Turnstile", () => {
  const source = readFileSync(path.join(process.cwd(), "app/sw.ts"), "utf8");
  const rule = source.indexOf("matcher: ({ url }) => isTurnstileUrl(url)");
  assert.ok(rule > 0, "app/sw.ts has a Turnstile rule");
  // Before defaultCache, whose last rule caches every cross-origin response.
  assert.ok(rule < source.indexOf("...defaultCache"));
  assert.match(
    source.slice(rule, rule + 120),
    /handler: new NetworkOnly\(\)/,
    "the Turnstile rule is network-only"
  );
});

test("password sign-in sends the token to Supabase Auth", async () => {
  const { signInWithPassword } = await import("@/app/auth/actions");
  const result = await run(
    signInWithPassword,
    form({
      email: USER.email,
      password: "correct horse",
      [CAPTCHA_TOKEN_FIELD]: "token-signin",
    })
  );

  assert.deepEqual(result, { redirect: "/" });
  assert.equal(authRequests[0]?.path, "/auth/v1/token?grant_type=password");
  assert.deepEqual(authRequests[0]?.body.gotrue_meta_security, {
    captcha_token: "token-signin",
  });
});

test("password sign-in without a token sends none", async () => {
  const { signInWithPassword } = await import("@/app/auth/actions");
  await run(
    signInWithPassword,
    form({ email: USER.email, password: "correct horse" })
  );

  assert.equal(authRequests.length, 1);
  assert.deepEqual(authRequests[0]?.body.gotrue_meta_security, {});
});

test("a failed captcha on sign-in says so, not that the password is wrong", async () => {
  const { signInWithPassword } = await import("@/app/auth/actions");
  authErrorCode = "captcha_failed";
  assert.deepEqual(
    await run(
      signInWithPassword,
      form({
        email: USER.email,
        password: "correct horse",
        [CAPTCHA_TOKEN_FIELD]: "used-token",
      })
    ),
    { error: CAPTCHA_FAILED_MESSAGE }
  );

  authErrorCode = "invalid_credentials";
  assert.deepEqual(
    await run(
      signInWithPassword,
      form({ email: USER.email, password: "wrong" })
    ),
    {
      error:
        "No se pudo iniciar sesión. Verificá tu correo electrónico y contraseña.",
    }
  );
});

const SIGN_UP_FIELDS = {
  displayName: "María Pérez",
  email: USER.email,
  password: "Segura-123",
  confirmPassword: "Segura-123",
};

test("sign-up sends the token to Supabase Auth", async () => {
  const { signUpWithPassword } = await import("@/app/auth/actions");
  const result = await run(
    signUpWithPassword,
    form({ ...SIGN_UP_FIELDS, [CAPTCHA_TOKEN_FIELD]: "token-signup" })
  );

  assert.deepEqual(result, { redirect: "/" });
  assert.equal(authRequests[0]?.path.split("?")[0], "/auth/v1/signup");
  assert.deepEqual(authRequests[0]?.body.gotrue_meta_security, {
    captcha_token: "token-signup",
  });
  assert.deepEqual(authRequests[0]?.body.data, { display_name: "María Pérez" });
});

test("sign-up without a token sends none, and a failed captcha is explained", async () => {
  const { signUpWithPassword } = await import("@/app/auth/actions");
  await run(signUpWithPassword, form(SIGN_UP_FIELDS));
  assert.deepEqual(authRequests[0]?.body.gotrue_meta_security, {});

  authErrorCode = "captcha_failed";
  assert.deepEqual(
    await run(
      signUpWithPassword,
      form({ ...SIGN_UP_FIELDS, [CAPTCHA_TOKEN_FIELD]: "used-token" })
    ),
    { error: CAPTCHA_FAILED_MESSAGE }
  );
});

test("the password reset request sends the token to Supabase Auth", async () => {
  const { requestPasswordReset } = await import("@/app/auth/actions");
  const result = await run(
    requestPasswordReset,
    form({ email: USER.email, [CAPTCHA_TOKEN_FIELD]: "token-reset" })
  );

  assert.deepEqual(result, {
    redirect: "/login?message=password_reset_requested",
  });
  assert.equal(authRequests[0]?.path.split("?")[0], "/auth/v1/recover");
  assert.equal(authRequests[0]?.body.email, USER.email);
  assert.deepEqual(authRequests[0]?.body.gotrue_meta_security, {
    captcha_token: "token-reset",
  });
});

test("a failed captcha on the reset request is shown; other errors stay hidden", async () => {
  const { requestPasswordReset } = await import("@/app/auth/actions");

  // Supabase checks the token before the address, so this answer is the
  // same whether the email has an account or not.
  authErrorCode = "captcha_failed";
  assert.deepEqual(
    await run(
      requestPasswordReset,
      form({ email: USER.email, [CAPTCHA_TOKEN_FIELD]: "used-token" })
    ),
    { error: CAPTCHA_FAILED_MESSAGE }
  );

  // Rate limits and send failures happen only for real accounts, so they
  // still look like success.
  authErrorCode = "over_email_send_rate_limit";
  assert.deepEqual(
    await run(requestPasswordReset, form({ email: USER.email })),
    { redirect: "/login?message=password_reset_requested" }
  );
});
