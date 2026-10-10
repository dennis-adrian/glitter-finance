import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  OFFLINE_PAGE_SOURCES,
  offlinePageRevision,
  readOfflinePageSources,
} from "@/lib/pwa/offline-page-revision";

const entries = [
  { url: ".next/static/chunks/app-1a2b.js", revision: null },
  { url: "public/icons/icon-192.png", revision: "aaaa" },
];
const base = { entries, sources: ["export default function Offline() {}"] };

test("the offline page revision is stable for the same build", () => {
  assert.equal(
    offlinePageRevision(base),
    offlinePageRevision({ ...base, entries: [...entries].reverse() })
  );
});

test("the offline page revision changes with the build", () => {
  const revision = offlinePageRevision(base);

  // A new hashed chunk or stylesheet the page's HTML links to.
  assert.notEqual(
    offlinePageRevision({
      ...base,
      entries: [{ ...entries[0], url: ".next/static/chunks/app-3c4d.js" }],
    }),
    revision
  );
  // A changed public file.
  assert.notEqual(
    offlinePageRevision({
      ...base,
      entries: [entries[0], { ...entries[1], revision: "bbbb" }],
    }),
    revision
  );
  // New server-rendered copy.
  assert.notEqual(
    offlinePageRevision({ ...base, sources: ["new copy"] }),
    revision
  );
  // Another deployed commit.
  assert.notEqual(offlinePageRevision({ ...base, commit: "abc123" }), revision);
});

test("reads the offline page's sources from the project", () => {
  for (const file of OFFLINE_PAGE_SOURCES) {
    assert.ok(existsSync(path.join(process.cwd(), file)), file);
  }
  assert.equal(readOfflinePageSources().length, OFFLINE_PAGE_SOURCES.length);
  assert.deepEqual(readOfflinePageSources("/nonexistent"), []);
});
