import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

const ORIGIN = "http://localhost:3000";

test("keeps same-origin paths with their query and hash", () => {
  assert.equal(
    sanitizeRedirectPath("/sales?range=today", ORIGIN),
    "/sales?range=today"
  );
  assert.equal(
    sanitizeRedirectPath("/join/invite-123#team", ORIGIN),
    "/join/invite-123#team"
  );
  assert.equal(sanitizeRedirectPath("/a/../b", ORIGIN), "/b");
});

test("rejects missing, absolute and protocol-relative targets", () => {
  for (const next of [
    null,
    "",
    "sales",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
  ]) {
    assert.equal(sanitizeRedirectPath(next, ORIGIN), "/", String(next));
  }
});

test("rejects paths that only normalize into a protocol-relative URL", () => {
  for (const next of [
    "/.//evil.example",
    "/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/.%2e//evil.example",
    "/./\\evil.example",
    "/.\\\\evil.example",
    "/x/..//evil.example",
    "/x/../\\/evil.example",
    "/.\t//evil.example",
    "/.\n//evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
  ]) {
    assert.equal(sanitizeRedirectPath(next, ORIGIN), "/", JSON.stringify(next));
  }
});

test("leaves encoded slashes and backslashes encoded on this origin", () => {
  assert.equal(
    sanitizeRedirectPath("/%2F%2Fevil.example", ORIGIN),
    "/%2F%2Fevil.example"
  );
  assert.equal(
    sanitizeRedirectPath("/%5C/evil.example", ORIGIN),
    "/%5C/evil.example"
  );
});

test("returns a path that sanitizes to itself", () => {
  for (const next of [
    "/sales?range=today",
    "/a/../b",
    "/.//evil.example",
    "/%2F%2Fevil.example",
    "/x/../\\/evil.example",
  ]) {
    const once = sanitizeRedirectPath(next, ORIGIN);
    assert.equal(sanitizeRedirectPath(once, ORIGIN), once, next);
    assert.equal(new URL(once, ORIGIN).origin, ORIGIN, next);
  }
});
