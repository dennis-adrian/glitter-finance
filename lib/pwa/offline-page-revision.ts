// Build time only (app/serwist/[path]/route.ts).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Rendered into the offline page's HTML on the server. Its client code and
// CSS are hashed through the precache entries.
export const OFFLINE_PAGE_SOURCES = [
  "app/~offline/page.tsx",
  "app/layout.tsx",
  "components/templates/status-screen.tsx",
];

/**
 * The precache revision of the offline page. Serwist refetches a precached
 * URL only when its revision changes, and the page's HTML links to this
 * build's hashed CSS and JS, which the next deploy removes from the precache.
 * So the revision changes with any precached file (the build's assets),
 * with the page's server-rendered sources and, on Vercel, with the commit.
 */
export function offlinePageRevision(input: {
  entries: { url: string; revision?: string | null }[];
  sources: (string | Uint8Array)[];
  commit?: string;
}) {
  const hash = createHash("md5");
  hash.update(`${input.commit ?? ""}\n`);
  for (const entry of [...input.entries].sort((a, b) =>
    a.url.localeCompare(b.url)
  )) {
    hash.update(`${entry.url} ${entry.revision ?? ""}\n`);
  }
  for (const source of input.sources) {
    hash.update(source);
  }
  return hash.digest("hex");
}

/** Reads OFFLINE_PAGE_SOURCES under `root`, skipping any that is missing. */
export function readOfflinePageSources(root = process.cwd()) {
  return OFFLINE_PAGE_SOURCES.flatMap((file) => {
    try {
      return [readFileSync(path.join(root, file))];
    } catch {
      return [];
    }
  });
}
