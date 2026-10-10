import assert from "node:assert/strict";
import test from "node:test";
import {
  expiryCheckDelayMs,
  MAX_TIMEOUT_MS,
} from "@/lib/invitations/validation";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function expiresIn(ms: number) {
  return new Date(NOW + ms).toISOString();
}

test("waits until the link expires when that fits in one timer", () => {
  assert.equal(expiryCheckDelayMs(expiresIn(7 * DAY_MS), NOW), 7 * DAY_MS);
});

test("waits in steps for a TTL longer than setTimeout allows", () => {
  const delay = expiryCheckDelayMs(expiresIn(30 * DAY_MS), NOW);

  assert.equal(delay, MAX_TIMEOUT_MS);
  // The next check still waits instead of hiding the link.
  assert.equal(
    expiryCheckDelayMs(expiresIn(30 * DAY_MS), NOW + MAX_TIMEOUT_MS),
    30 * DAY_MS - MAX_TIMEOUT_MS
  );
});

test("reports an expired link", () => {
  assert.equal(expiryCheckDelayMs(expiresIn(0), NOW), null);
  assert.equal(expiryCheckDelayMs(expiresIn(-1), NOW), null);
});
