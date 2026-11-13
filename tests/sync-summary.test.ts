import assert from "node:assert/strict";
import test from "node:test";
import {
  isWaitingForSyncSlot,
  summarizeSync,
} from "@/lib/powersync/sync-summary";
import type { SyncState } from "@/lib/powersync/sync-status";

const NOW = Date.parse("2026-11-13T15:00:00Z");

function status(
  state: SyncState,
  overrides: Partial<Parameters<typeof summarizeSync>[0]> = {}
) {
  return {
    state,
    lastSyncedAt: new Date(NOW - 4 * 60_000),
    pendingCount: 0,
    downloadError: null,
    ...overrides,
  };
}

test("a refused connection at the service's limit is waiting for a slot", () => {
  assert.equal(
    isWaitingForSyncSlot(
      "Closed. Original cause [Error: [PSYNC_S2304] Maximum active concurrent connections limit has been reached]."
    ),
    true
  );
  assert.equal(isWaitingForSyncSlot("HTTP Too Many Requests: "), true);
  assert.equal(isWaitingForSyncSlot("Request failed with status 429"), true);
  assert.equal(isWaitingForSyncSlot("Failed to fetch"), false);
  assert.equal(isWaitingForSyncSlot("PSYNC_S2103 JWT has expired"), false);
  assert.equal(isWaitingForSyncSlot(null), false);
});

test("a synced device says so, with when it last synced", () => {
  const summary = summarizeSync(status("synced"), NOW);
  assert.equal(summary.headline, "Todo está al día");
  assert.equal(summary.lastSynced, "Última sincronización: hace 4 min");
  assert.equal(summary.detail, null);
  assert.equal(summary.canSyncNow, true);
});

test("a device that never synced says that in place of a time", () => {
  const summary = summarizeSync(status("syncing", { lastSyncedAt: null }), NOW);
  assert.equal(summary.lastSynced, "Este dispositivo todavía no se sincronizó");
});

test("syncing counts what is still to upload", () => {
  assert.equal(
    summarizeSync(status("syncing", { pendingCount: 1 }), NOW).detail,
    "1 cambio pendiente de subir."
  );
  assert.equal(
    summarizeSync(status("syncing", { pendingCount: 3 }), NOW).detail,
    "3 cambios pendientes de subir."
  );
  assert.equal(summarizeSync(status("syncing"), NOW).detail, null);
});

test("waiting for a slot reassures that sales still upload", () => {
  const summary = summarizeSync(
    status("offline", { downloadError: "[PSYNC_S2304] limit reached" }),
    NOW
  );
  assert.equal(summary.headline, "Esperando turno para sincronizar");
  assert.match(summary.detail ?? "", /Tus ventas se suben a la nube igual/);
  assert.equal(summary.canSyncNow, true);
});

test("plain offline says selling goes on", () => {
  const summary = summarizeSync(
    status("offline", { downloadError: "Failed to fetch" }),
    NOW
  );
  assert.equal(summary.headline, "Sin conexión con la nube");
  assert.match(summary.detail ?? "", /Podés seguir vendiendo/);
});

test("the button is off only where reconnecting cannot help", () => {
  const states: SyncState[] = [
    "initializing",
    "offline",
    "syncing",
    "synced",
    "held",
    "tenant-changed",
    "blocked",
  ];
  const off = states.filter(
    (state) => !summarizeSync(status(state), NOW).canSyncNow
  );
  assert.deepEqual(off, ["initializing", "tenant-changed"]);
});

test("every state has a headline", () => {
  for (const state of [
    "initializing",
    "offline",
    "syncing",
    "synced",
    "held",
    "tenant-changed",
    "blocked",
  ] as const) {
    assert.ok(summarizeSync(status(state), NOW).headline.length > 0, state);
  }
});
