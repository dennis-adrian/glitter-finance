// Watching the local tables from the first write on.
//
// Until the first sync completes on a fresh or cleared database (a new
// device, and after every sign-in, tenant switch or join), PowerSync has not
// applied any server data yet: the local tables hold only this device's own
// writes. Watching only from then on hid a sale, product or stock movement
// recorded in that window until the sync finished. Watching from the start
// and merging the local rows over the server-rendered data shows them at
// once, without a second, optimistic copy of each write.

import type { AbstractPowerSyncDatabase } from "@powersync/web";

/**
 * Runs `watch` now and again once the first sync has completed, aborting the
 * earlier run. `synced` says which case applies: before the first sync the
 * rows must be merged over the server-rendered data (see
 * mergeLocalRowsOverServer), afterwards they replace it. A database that has
 * synced before (PowerSync persists that) starts in the synced case. Returns
 * the cleanup.
 */
export function watchLocalTables(
  db: AbstractPowerSyncDatabase,
  watch: (input: { signal: AbortSignal; synced: boolean }) => void
): () => void {
  let controller = new AbortController();
  let unregister: (() => void) | undefined;

  if (db.currentStatus?.hasSynced) {
    watch({ signal: controller.signal, synced: true });
  } else {
    watch({ signal: controller.signal, synced: false });
    unregister = db.registerListener({
      statusChanged: (status) => {
        if (!status.hasSynced) return;
        unregister?.();
        unregister = undefined;
        controller.abort();
        controller = new AbortController();
        watch({ signal: controller.signal, synced: true });
      },
    });
  }

  return () => {
    controller.abort();
    unregister?.();
  };
}

/**
 * Local rows read before the first sync, over the server-rendered rows: a
 * local row replaces the server row with the same id, server rows the device
 * has not touched stay, and rows only the device has come first.
 */
export function mergeLocalRowsOverServer<T extends { id: string }>(
  server: readonly T[],
  local: readonly T[]
): T[] {
  const localById = new Map(local.map((row) => [row.id, row]));
  const serverIds = new Set(server.map((row) => row.id));
  return [
    ...local.filter((row) => !serverIds.has(row.id)),
    ...server.map((row) => localById.get(row.id) ?? row),
  ];
}

/**
 * Watches one query over the active tenant's rows (see watchLocalTables) and
 * hands `onRows` every result, with whether the first sync has completed.
 * The query's one parameter is the tenant id. A result is dropped once its
 * run was replaced or `isCurrent` turns false (the tenant work it was read
 * for was cancelled). Returns the cleanup.
 */
export function watchTenantRows<Row>(
  db: AbstractPowerSyncDatabase,
  input: {
    sql: string;
    tenantId: string;
    isCurrent: () => boolean;
    onRows: (rows: Row[], synced: boolean) => void;
    onError: (error: Error) => void;
    /** Watch only once the first sync has completed. */
    syncedOnly?: boolean;
  }
): () => void {
  return watchLocalTables(db, ({ signal, synced }) => {
    if (input.syncedOnly && !synced) return;
    db.watch(
      input.sql,
      [input.tenantId],
      {
        onResult: (results) => {
          if (signal.aborted || !input.isCurrent()) return;
          input.onRows((results.rows?._array ?? []) as Row[], synced);
        },
        onError: input.onError,
      },
      { signal }
    );
  });
}
