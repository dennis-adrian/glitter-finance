// The public landing page, robots.txt, the sitemap and the noindex headers:
// what search engines may index, and the PWA invariants the landing page must
// not break.

import assert from "node:assert/strict";
import test from "node:test";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
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

const production = { NEXT_PUBLIC_APP_URL: "https://pos.example.com" };

async function robotsFor(env: Record<string, string>) {
  requestHeaders = new Headers({ host: "evil.example" });
  const { default: robots } = await import("@/app/robots");
  return withEnv(ORIGIN_ENV, env, () => robots());
}

async function sitemapFor(env: Record<string, string>) {
  requestHeaders = new Headers({ host: "evil.example" });
  const { default: sitemap } = await import("@/app/sitemap");
  return withEnv(ORIGIN_ENV, env, () => sitemap());
}

test("the landing page is not the app shell or the PWA start URL", async () => {
  const { LANDING_PATH } = await import("@/lib/public-site");
  const { APP_SHELL_URL, OFFLINE_PAGE_URL } =
    await import("@/lib/pwa/cache-names");
  const { GET } = await import("@/app/manifest.webmanifest/route");

  const manifest = await (
    await GET(new Request("http://localhost/manifest.webmanifest"))
  ).json();
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(APP_SHELL_URL, "/");
  assert.notEqual(LANDING_PATH, APP_SHELL_URL);
  assert.notEqual(LANDING_PATH, OFFLINE_PAGE_URL);
});

test("robots.txt lets crawlers reach the pages that answer noindex", async () => {
  const robots = await robotsFor(production);
  const rules = [robots.rules].flat();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].userAgent, "*");
  assert.equal(rules[0].allow, "/");

  const disallow = [rules[0].disallow ?? []].flat();
  assert.ok(disallow.includes("/api/"));
  // Disallowed, a token URL could still be listed bare; it must be fetched
  // and refused with noindex instead.
  for (const path of ["/", "/bienvenida", "/login", "/join/", "/auth/"]) {
    assert.ok(
      !disallow.some((prefix) => path.startsWith(prefix)),
      `${path} is disallowed`
    );
  }
  assert.equal(robots.sitemap, "https://pos.example.com/sitemap.xml");
});

test("robots.txt names no sitemap without a trusted origin", async () => {
  const robots = await robotsFor({});
  assert.equal(robots.sitemap, undefined);
});

test("a Vercel preview (staging) is closed to crawlers", async () => {
  const preview = {
    VERCEL_ENV: "preview",
    VERCEL_BRANCH_URL: "glitter-pos-git-x.vercel.app",
  };
  const robots = await robotsFor(preview);
  assert.deepEqual(robots.rules, { userAgent: "*", disallow: "/" });
  assert.equal(robots.sitemap, undefined);
  assert.deepEqual(await sitemapFor(preview), []);
});

test("the sitemap lists the landing page at the trusted origin", async () => {
  const entries = await sitemapFor(production);
  assert.deepEqual(
    entries.map((entry) => entry.url),
    ["https://pos.example.com/bienvenida"]
  );
});

test("the sitemap is empty rather than built on an untrusted host", async () => {
  assert.deepEqual(await sitemapFor({}), []);
});

function noindexed(pathname: string, sources: readonly string[]) {
  return sources.some(
    (source) =>
      getPathMatch(source, { strict: true, removeUnnamedParams: true })(
        pathname
      ) !== false
  );
}

test("invitation, sign-in, auth and API URLs answer noindex", async () => {
  const { NOINDEX_SOURCES } = await import("@/lib/public-site");
  for (const pathname of [
    "/login",
    "/join/3f1c2a9e-token",
    "/auth/callback",
    "/auth/confirm",
    "/auth/update-password",
    "/api/health",
    "/~offline",
  ]) {
    assert.equal(noindexed(pathname, NOINDEX_SOURCES), true, pathname);
  }
  for (const pathname of ["/", "/bienvenida", "/robots.txt", "/sitemap.xml"]) {
    assert.equal(noindexed(pathname, NOINDEX_SOURCES), false, pathname);
  }
});

test("every indexable page is outside the noindex sources", async () => {
  const { INDEXABLE_PATHS, NOINDEX_SOURCES } =
    await import("@/lib/public-site");
  for (const pathname of INDEXABLE_PATHS) {
    assert.equal(noindexed(pathname, NOINDEX_SOURCES), false, pathname);
  }
});

test("share metadata carries the image, and a URL only when given", async () => {
  const { SHARE_IMAGE, shareMetadata } = await import("@/lib/public-site");
  const base = shareMetadata({ title: "T", description: "D" });
  assert.deepEqual(base.openGraph.images, [SHARE_IMAGE]);
  assert.equal(base.twitter.card, "summary_large_image");
  assert.equal("url" in base.openGraph, false);

  const landing = shareMetadata({
    title: "T",
    description: "D",
    path: "/bienvenida",
  });
  assert.equal(landing.openGraph.url, "/bienvenida");
  assert.deepEqual(landing.openGraph.images, [SHARE_IMAGE]);
});

test("the installed app is detected in standalone mode and on iOS", async () => {
  const { isInstalledApp } =
    await import("@/components/atoms/installed-app-redirect");
  const media = (standalone: boolean) => (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
  });
  assert.equal(isInstalledApp(media(true), {}), true);
  assert.equal(isInstalledApp(media(false), { standalone: true }), true);
  assert.equal(isInstalledApp(media(false), {}), false);
  assert.equal(isInstalledApp(media(false), { standalone: false }), false);
});
