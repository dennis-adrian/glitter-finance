// getRequestOrigin builds invitation links and auth callback URLs, so a
// spoofed header must never make it return another site's origin.

import assert from "node:assert/strict";
import test from "node:test";
import { stubModule, withEnv } from "./support/stub-module";

let requestHeaders = new Headers();
stubModule("next/headers", { headers: async () => requestHeaders });

const ORIGIN_ENV = [
  "VERCEL_ENV",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
];

async function originFor(
  env: Record<string, string>,
  headers: Record<string, string> = {}
) {
  requestHeaders = new Headers(headers);
  const { getRequestOrigin } = await import("@/lib/request-origin");
  return withEnv(ORIGIN_ENV, env, () => getRequestOrigin());
}

const spoofed = {
  host: "evil.example",
  "x-forwarded-host": "evil.example",
  "x-forwarded-proto": "http",
  origin: "https://evil.example",
};

test("a configured app URL wins over every request header", async () => {
  assert.equal(
    await originFor(
      { NEXT_PUBLIC_APP_URL: "https://pos.example.com/" },
      spoofed
    ),
    "https://pos.example.com"
  );
  assert.equal(
    await originFor({ APP_URL: "https://pos.example.com" }, spoofed),
    "https://pos.example.com"
  );
  assert.equal(
    await originFor({
      NEXT_PUBLIC_APP_URL: "https://pos.example.com",
      APP_URL: "https://other.example.com",
    }),
    "https://pos.example.com"
  );
});

test("a preview deployment links to its own branch URL", async () => {
  const preview = {
    VERCEL_ENV: "preview",
    VERCEL_BRANCH_URL: "glitter-pos-git-feature.vercel.app",
    VERCEL_URL: "glitter-pos-abc123.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://pos.example.com",
  };
  assert.equal(
    await originFor(preview, spoofed),
    "https://glitter-pos-git-feature.vercel.app"
  );
  assert.equal(
    await originFor({ ...preview, VERCEL_BRANCH_URL: "" }),
    "https://glitter-pos-abc123.vercel.app"
  );
});

test("production falls back to the Vercel production URL", async () => {
  assert.equal(
    await originFor(
      {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "pos.vercel.app",
        VERCEL_URL: "glitter-pos-abc123.vercel.app",
      },
      spoofed
    ),
    "https://pos.vercel.app"
  );
});

test("an app URL that is not https on a public host is ignored", async () => {
  for (const url of [
    "http://pos.example.com",
    "javascript:alert(1)",
    "ftp://pos.example.com",
  ]) {
    assert.equal(
      await originFor({ NEXT_PUBLIC_APP_URL: url }, spoofed),
      "",
      url
    );
  }
  // The host still counts as the app's own, and is served over https.
  assert.equal(
    await originFor(
      { NEXT_PUBLIC_APP_URL: "http://pos.example.com" },
      { host: "pos.example.com" }
    ),
    "https://pos.example.com"
  );
  assert.equal(
    await originFor({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    "http://localhost:3000"
  );
});

test("without configuration only loopback hosts are trusted", async () => {
  assert.equal(await originFor({}, spoofed), "");
  assert.equal(await originFor({}, { host: "evil.example" }), "");
  assert.equal(
    await originFor({}, { host: "localhost:3000" }),
    "http://localhost:3000"
  );
  assert.equal(
    await originFor(
      {},
      { host: "127.0.0.1:3000", "x-forwarded-proto": "https" }
    ),
    "https://127.0.0.1:3000"
  );
});

test("a forwarded host takes the place of Host, and must pass on its own", async () => {
  assert.equal(
    await originFor(
      {},
      { host: "localhost:3000", "x-forwarded-host": "evil.example" }
    ),
    ""
  );
  assert.equal(
    await originFor({}, { "x-forwarded-host": "localhost:3000, evil.example" }),
    "http://localhost:3000"
  );
  assert.equal(
    await originFor({}, { "x-forwarded-host": "evil.example, localhost:3000" }),
    ""
  );
});

test("the Origin header is never used", async () => {
  assert.equal(
    await originFor(
      {},
      { host: "localhost:3000", origin: "https://evil.example" }
    ),
    "http://localhost:3000"
  );
});

test("malformed hosts and protocols are rejected", async () => {
  for (const host of [
    "localhost:3000/path",
    "user@localhost",
    "localhost:99999",
    "localhost:0",
    "evil.example\\@localhost",
    "",
  ]) {
    assert.equal(await originFor({}, { host }), "", JSON.stringify(host));
  }
  assert.equal(
    await originFor(
      {},
      { host: "localhost:3000", "x-forwarded-proto": "javascript" }
    ),
    "http://localhost:3000"
  );
});
