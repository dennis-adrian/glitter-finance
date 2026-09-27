import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, SyncStatus } from "@powersync/web";
import {
  mergeLocalRowsOverServer,
  watchLocalTables,
} from "@/lib/powersync/local-watch";

function fakeDb(hasSynced: boolean) {
  const listeners = new Set<{ statusChanged?: (status: SyncStatus) => void }>();
  const db = {
    currentStatus: { hasSynced } as SyncStatus,
    registerListener: (listener: {
      statusChanged?: (status: SyncStatus) => void;
    }) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AbstractPowerSyncDatabase;
  const emit = (status: Partial<SyncStatus>) => {
    for (const listener of [...listeners]) {
      listener.statusChanged?.(status as SyncStatus);
    }
  };
  return { db, listeners, emit };
}

test("a synced database is watched once, as complete", () => {
  const { db, listeners } = fakeDb(true);
  const runs: boolean[] = [];

  const stop = watchLocalTables(db, ({ synced }) => runs.push(synced));

  assert.deepEqual(runs, [true]);
  assert.equal(listeners.size, 0);
  stop();
});

test("a fresh database is watched at once and again after the first sync", () => {
  const { db, listeners, emit } = fakeDb(false);
  const runs: { synced: boolean; signal: AbortSignal }[] = [];

  const stop = watchLocalTables(db, (run) => runs.push(run));
  assert.deepEqual(
    runs.map((run) => run.synced),
    [false]
  );

  emit({ hasSynced: false });
  assert.equal(runs.length, 1);

  emit({ hasSynced: true });
  assert.deepEqual(
    runs.map((run) => run.synced),
    [false, true]
  );
  assert.equal(runs[0].signal.aborted, true);
  assert.equal(runs[1].signal.aborted, false);
  assert.equal(listeners.size, 0);

  emit({ hasSynced: true });
  assert.equal(runs.length, 2);

  stop();
  assert.equal(runs[1].signal.aborted, true);
});

test("cleanup before the first sync stops listening", () => {
  const { db, listeners } = fakeDb(false);
  const runs: AbortSignal[] = [];

  const stop = watchLocalTables(db, ({ signal }) => runs.push(signal));
  stop();

  assert.equal(runs[0].aborted, true);
  assert.equal(listeners.size, 0);
});

test("local rows replace or join the server-rendered rows", () => {
  const server = [
    { id: "a", name: "Aretes" },
    { id: "b", name: "Pulsera" },
  ];
  const local = [
    { id: "c", name: "Nuevo" },
    { id: "b", name: "Pulsera dorada" },
  ];

  assert.deepEqual(mergeLocalRowsOverServer(server, local), [
    { id: "c", name: "Nuevo" },
    { id: "a", name: "Aretes" },
    { id: "b", name: "Pulsera dorada" },
  ]);
  assert.deepEqual(mergeLocalRowsOverServer(server, []), server);
});
