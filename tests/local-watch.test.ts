import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, SyncStatus } from "@powersync/web";
import {
  mergeLocalRowsOverServer,
  watchLocalTables,
  watchTenantRows,
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

type FakeWatch = {
  sql: string;
  params: unknown[];
  signal: AbortSignal;
  emit: (rows: unknown[]) => void;
  fail: (error: Error) => void;
};

function fakeWatchedDb(hasSynced: boolean) {
  const fake = fakeDb(hasSynced);
  const watches: FakeWatch[] = [];
  Object.assign(fake.db, {
    watch: (
      sql: string,
      params: unknown[],
      handler: {
        onResult: (results: { rows?: { _array: unknown[] } }) => void;
        onError?: (error: Error) => void;
      },
      options: { signal: AbortSignal }
    ) => {
      watches.push({
        sql,
        params,
        signal: options.signal,
        emit: (rows) => handler.onResult({ rows: { _array: rows } }),
        fail: (error) => handler.onError?.(error),
      });
    },
  });
  return { ...fake, watches };
}

test("tenant rows are read for the tenant, merged, then complete", () => {
  const { db, emit, watches } = fakeWatchedDb(false);
  const results: { rows: unknown[]; synced: boolean }[] = [];
  const errors: Error[] = [];

  const stop = watchTenantRows(db, {
    sql: "SELECT * FROM products WHERE tenant_id = ?",
    tenantId: "tenant-a",
    isCurrent: () => true,
    onRows: (rows, synced) => results.push({ rows, synced }),
    onError: (error) => errors.push(error),
  });
  assert.equal(watches.length, 1);
  assert.equal(watches[0].sql, "SELECT * FROM products WHERE tenant_id = ?");
  assert.deepEqual(watches[0].params, ["tenant-a"]);

  watches[0].emit([{ id: "local" }]);
  emit({ hasSynced: true });
  // The run before the first sync was replaced: its late results are dropped.
  watches[0].emit([{ id: "stale" }]);
  watches[1].emit([{ id: "local" }, { id: "synced" }]);
  watches[1].fail(new Error("SQLITE_BUSY"));

  assert.deepEqual(results, [
    { rows: [{ id: "local" }], synced: false },
    { rows: [{ id: "local" }, { id: "synced" }], synced: true },
  ]);
  assert.deepEqual(
    errors.map((error) => error.message),
    ["SQLITE_BUSY"]
  );
  stop();
  assert.equal(watches[1].signal.aborted, true);
});

test("tenant rows are dropped once the tenant work moved on", () => {
  const { db, watches } = fakeWatchedDb(true);
  let current = true;
  const results: unknown[][] = [];

  const stop = watchTenantRows(db, {
    sql: "SELECT * FROM products WHERE tenant_id = ?",
    tenantId: "tenant-a",
    isCurrent: () => current,
    onRows: (rows) => results.push(rows),
    onError: () => {},
  });
  watches[0].emit([{ id: "a" }]);
  current = false;
  watches[0].emit([{ id: "b" }]);

  assert.deepEqual(results, [[{ id: "a" }]]);
  stop();
});

test("a synced-only watch starts with the first sync", () => {
  const { db, emit, watches } = fakeWatchedDb(false);
  const results: { rows: unknown[]; synced: boolean }[] = [];

  const stop = watchTenantRows(db, {
    sql: "SELECT * FROM tenant_users WHERE tenant_id = ?",
    tenantId: "tenant-a",
    isCurrent: () => true,
    syncedOnly: true,
    onRows: (rows, synced) => results.push({ rows, synced }),
    onError: () => {},
  });
  assert.equal(watches.length, 0);

  emit({ hasSynced: true });
  watches[0].emit([{ id: "member" }]);

  assert.deepEqual(results, [{ rows: [{ id: "member" }], synced: true }]);
  stop();
});
