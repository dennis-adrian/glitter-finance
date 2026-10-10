// Build time only (app/serwist/[path]/route.ts). The prebuild script copies
// all of @powersync/web/dist into public/@powersync, but the app loads only a
// few of those files. This picks them out of the worker bundle, so the
// service worker precaches exactly what an offline start needs (including
// the SQLite .wasm) and skips the rest.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Where `powersync-web copy-assets -o public` puts @powersync/web/dist. */
export const POWERSYNC_ASSET_DIR = "public/@powersync";

// The workers components/providers/powersync-provider.tsx starts, relative to
// POWERSYNC_ASSET_DIR.
export const POWERSYNC_DATABASE_WORKER = "worker/WASQLiteDB.umd.js";
export const POWERSYNC_SYNC_WORKER = "worker/SharedSyncImplementation.umd.js";

// The modules the database worker imports for the provider's settings:
// WASQLiteVFS.OPFSCoopSyncVFS, which uses the synchronous wa-sqlite build,
// without an encryption key.
const DATABASE_WORKER_MODULES = [
  "@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js",
  "@journeyapps/wa-sqlite/dist/wa-sqlite.mjs",
];

export type PowerSyncAssets = {
  /** Every file under POWERSYNC_ASSET_DIR, relative to it, with "/". */
  files: string[];
  readText: (file: string) => string | null;
};

export type PowerSyncPrecachePlan = {
  /** Glob patterns, relative to the project root, to precache. */
  include: string[];
  /** Files, relative to the project root, the precache must skip. */
  ignore: string[];
  /** Set when the bundle could not be read and everything is precached. */
  warning?: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// webpack's lazy import in the worker bundle:
//   __webpack_require__.e(/*! import() */ "<chunk>").then(
//     __webpack_require__.bind(__webpack_require__, /*! <module> */ ...
function chunkImporting(source: string, modulePath: string) {
  const pattern = new RegExp(
    `__webpack_require__\\.e\\(/\\*! import\\(\\) \\*/ "([^"]+)"\\)\\.then\\(__webpack_require__\\.bind\\(__webpack_require__, /\\*! ${escapeRegExp(modulePath)} \\*/`
  );
  return source.match(pattern)?.[1] ?? null;
}

/**
 * The files the app loads, relative to POWERSYNC_ASSET_DIR: both workers,
 * the chunks the database worker imports, and each .wasm those chunks
 * fetch. Null when the bundle no longer has the shape this expects.
 */
export function selectPowerSyncFiles(assets: PowerSyncAssets): string[] | null {
  const worker = assets.readText(POWERSYNC_DATABASE_WORKER);
  if (worker == null || !assets.files.includes(POWERSYNC_SYNC_WORKER)) {
    return null;
  }

  const selected = [POWERSYNC_DATABASE_WORKER, POWERSYNC_SYNC_WORKER];
  for (const modulePath of DATABASE_WORKER_MODULES) {
    const chunk = chunkImporting(worker, modulePath);
    const chunkFile = chunk ? `worker/${chunk}.umd.js` : null;
    const chunkSource = chunkFile ? assets.readText(chunkFile) : null;
    if (!chunkFile || chunkSource == null) {
      return null;
    }
    selected.push(chunkFile);
    // The worker's public path is POWERSYNC_ASSET_DIR ("worker/../").
    for (const match of chunkSource.matchAll(
      /__webpack_require__\.p \+ "([^"]+\.wasm)"/g
    )) {
      selected.push(match[1]);
    }
  }

  return selected.every((file) => assets.files.includes(file))
    ? selected
    : null;
}

export function planPowerSyncPrecache(
  assets: PowerSyncAssets
): PowerSyncPrecachePlan {
  const inAssetDir = (file: string) => `${POWERSYNC_ASSET_DIR}/${file}`;
  const selected = selectPowerSyncFiles(assets);
  if (!selected) {
    // Still start offline, at the cost of precaching unused bundles; the
    // app imports @powersync/web from node_modules, never index.umd.js.
    return {
      include: [inAssetDir("**/*.{js,wasm}")],
      ignore: [inAssetDir("index.umd.js")],
      warning: `Could not tell which ${POWERSYNC_ASSET_DIR} files the app loads, so all of them are precached. Update lib/pwa/powersync-precache.ts for this @powersync/web version.`,
    };
  }

  return {
    include: selected.map(inAssetDir),
    ignore: assets.files
      .filter((file) => !selected.includes(file))
      .map(inAssetDir),
  };
}

/** Reads the copied PowerSync assets; empty when they were not copied. */
export function readPowerSyncAssets(
  directory = path.join(process.cwd(), POWERSYNC_ASSET_DIR)
): PowerSyncAssets {
  let files: string[];
  try {
    files = readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path
          .relative(directory, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join("/")
      );
  } catch {
    files = [];
  }

  return {
    files,
    readText: (file) => {
      if (!files.includes(file)) return null;
      try {
        return readFileSync(path.join(directory, file), "utf8");
      } catch {
        return null;
      }
    },
  };
}
