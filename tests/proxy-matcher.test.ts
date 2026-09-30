import assert from "node:assert/strict";
import test from "node:test";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import type { ProxyMatcher } from "next/dist/build/analysis/get-page-static-info";
import { config } from "@/proxy";

// Exported at runtime but missing from Next.js' published types.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (
    matcher: string | string[],
    nextConfig: object
  ) => ProxyMatcher[];
};

// Compiles the matcher the way `next build` does, so the test follows any
// change to how Next.js anchors or suffixes the pattern.
const matchers = getMiddlewareMatchers(config.matcher, {});

function runsProxy(pathname: string) {
  return matchers.some(({ regexp }) => new RegExp(regexp).test(pathname));
}

test("refreshes the session on pages and auth routes", () => {
  for (const pathname of [
    "/",
    "/login",
    "/join/some-token",
    "/auth/callback",
    "/auth/confirm",
    "/auth/update-password",
  ]) {
    assert.equal(runsProxy(pathname), true, pathname);
  }
});

test("skips the service worker, PowerSync assets and other non-pages", () => {
  for (const pathname of [
    "/monitoring",
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/favicon.ico",
    "/serwist/sw.js",
    "/serwist/sw.js.map",
    "/@powersync/worker/SharedSyncImplementation.umd.js",
    "/@powersync/wa-sqlite-async.wasm",
    "/manifest.webmanifest",
    "/api/health",
    "/~offline",
    "/icons/icon-512.png",
    "/icons/billetera-ferial-logo.svg",
  ]) {
    assert.equal(runsProxy(pathname), false, pathname);
  }
});
