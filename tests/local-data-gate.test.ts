import assert from "node:assert/strict";
import test from "node:test";
import {
  getLocalDataChangeBlocker,
  pendingUploadsBlockerMessage,
} from "@/lib/powersync/local-data-gate";

const settled = {
  powerSyncConfigured: true,
  syncState: "synced" as const,
  pendingCount: 0,
  failureCount: 0,
};

test("a synced device with an empty queue may clear its local data", () => {
  assert.equal(getLocalDataChangeBlocker(settled), null);
});

test("pending uploads block clearing even while connected and synced", () => {
  assert.equal(
    getLocalDataChangeBlocker({ ...settled, pendingCount: 2 }),
    "pending-uploads"
  );
});

test("sync failures take precedence over pending uploads", () => {
  assert.equal(
    getLocalDataChangeBlocker({
      ...settled,
      syncState: "blocked",
      pendingCount: 1,
      failureCount: 1,
    }),
    "sync-failures"
  );
});

test("an unsettled sync blocks clearing, including before the db is ready", () => {
  for (const syncState of ["initializing", "offline", "syncing"] as const) {
    assert.equal(
      getLocalDataChangeBlocker({ ...settled, syncState }),
      "not-synced"
    );
  }
});

test("without PowerSync there is no queue to protect", () => {
  assert.equal(
    getLocalDataChangeBlocker({
      ...settled,
      powerSyncConfigured: false,
      syncState: "initializing",
    }),
    null
  );
});

test("the pending uploads message agrees in number", () => {
  assert.equal(
    pendingUploadsBlockerMessage(1, "cerrar sesión"),
    "Hay 1 operación sin subir a la nube. Conéctate y espera a que se sincronice antes de cerrar sesión."
  );
  assert.equal(
    pendingUploadsBlockerMessage(3, "unirte"),
    "Hay 3 operaciones sin subir a la nube. Conéctate y espera a que se sincronicen antes de unirte."
  );
});
