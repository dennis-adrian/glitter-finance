import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  planPowerSyncPrecache,
  POWERSYNC_ASSET_DIR,
  POWERSYNC_DATABASE_WORKER,
  POWERSYNC_SYNC_WORKER,
  readPowerSyncAssets,
} from "@/lib/pwa/powersync-precache";

// The files `powersync-web copy-assets` copies into public/@powersync.
const installedAssets = readPowerSyncAssets(
  path.join(process.cwd(), "node_modules/@powersync/web/dist")
);

test("precaches only the PowerSync files the app loads", () => {
  const plan = planPowerSyncPrecache(installedAssets);
  const included = plan.include.map((file) =>
    file.slice(POWERSYNC_ASSET_DIR.length + 1)
  );
  const wasm = included.filter((file) => file.endsWith(".wasm"));

  assert.equal(plan.warning, undefined);
  assert.ok(included.includes(POWERSYNC_DATABASE_WORKER));
  assert.ok(included.includes(POWERSYNC_SYNC_WORKER));
  // OPFSCoopSyncVFS and the synchronous, unencrypted wa-sqlite build it uses.
  assert.equal(included.filter((file) => /examples-/.test(file)).length, 1);
  assert.ok(included.some((file) => file.endsWith("wa-sqlite_mjs.umd.js")));
  assert.equal(wasm.length, 1);
  assert.ok(installedAssets.files.includes(wasm[0]));
  // Unused: the UMD main bundle (the app bundles @powersync/web itself) and
  // the encrypted (MultipleCiphers) builds.
  assert.ok(!included.includes("index.umd.js"));
  assert.ok(!included.some((file) => file.includes("_mc-wa-s")));
  assert.ok(plan.ignore.includes(`${POWERSYNC_ASSET_DIR}/index.umd.js`));
  for (const file of plan.include) {
    assert.ok(!plan.ignore.includes(file));
  }
});

test("the plan matches how the provider opens the database", () => {
  // If this fails, the database settings changed: update the module list in
  // lib/pwa/powersync-precache.ts so an offline start still has its files.
  const provider = readFileSync(
    path.join(process.cwd(), "components/providers/powersync-provider.tsx"),
    "utf8"
  );
  assert.match(provider, /vfs: WASQLiteVFS\.OPFSCoopSyncVFS/);
  assert.doesNotMatch(provider, /encryptionKey/);
  assert.ok(provider.includes(`"/@powersync/${POWERSYNC_DATABASE_WORKER}"`));
  assert.ok(provider.includes(`"/@powersync/${POWERSYNC_SYNC_WORKER}"`));
});

test("precaches every PowerSync file when the bundle is unrecognized", () => {
  const plan = planPowerSyncPrecache({
    files: [POWERSYNC_DATABASE_WORKER, POWERSYNC_SYNC_WORKER, "index.umd.js"],
    readText: () => "console.log('a future bundle format');",
  });

  assert.ok(plan.warning);
  assert.deepEqual(plan.include, [`${POWERSYNC_ASSET_DIR}/**/*.{js,wasm}`]);
  assert.deepEqual(plan.ignore, [`${POWERSYNC_ASSET_DIR}/index.umd.js`]);
});

test("reads nothing when the assets were not copied", () => {
  const assets = readPowerSyncAssets(
    path.join(process.cwd(), "node_modules/.no-powersync-assets")
  );
  assert.deepEqual(assets.files, []);
  assert.equal(assets.readText(POWERSYNC_DATABASE_WORKER), null);
});
