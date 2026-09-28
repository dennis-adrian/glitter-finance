// Discarding a transaction the server keeps rejecting.
//
// A permanent upload failure stays at the head of PowerSync's upload queue,
// so nothing queued behind it uploads, and retrying sends the same payload.
// When the rejection is deterministic, the only way forward on the device is
// to drop the transaction: remove it from the queue, undo what it changed in
// the local tables, and keep its failure record (payload included) as
// discarded, for the diagnostic export.
//
// Undoing the local change follows what PowerSync does when it applies a
// checkpoint: each affected row goes back to the last version the server sent
// (PowerSync's ps_oplog), and the local changes still queued after the
// discarded transaction are applied on top again. Rows are written straight
// to ps_data__<table>, like the connector's own reverts, so the undo is not
// queued as a new upload. PowerSync also re-reads these rows from the server
// at the next checkpoint once the queue is empty, which covers any case this
// cannot know about (see planLocalRevert).

import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  Transaction,
} from "@powersync/web";
import { reportDiscardedSyncFailure } from "@/lib/observability/report-sync-failure";
import { syncFailureId } from "@/lib/powersync/crud-metadata";
import {
  parseSyncFailureOperations,
  reconcileSyncFailures,
} from "@/lib/powersync/sync-failures";

/** The synced tables (lib/db/client-schema.ts); local-only tables never upload. */
export const SYNCED_TABLE_NAMES = [
  "products",
  "sales",
  "sale_lines",
  "refunds",
  "tenant_users",
  "inventory_movements",
] as const;

const syncedTables = new Set<string>(SYNCED_TABLE_NAMES);

export class SyncFailureDiscardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncFailureDiscardError";
  }
}

export const SYNC_FAILURE_NOT_PENDING_MESSAGE =
  "Esta operación ya no está pendiente.";
export const SYNC_FAILURE_NOT_NEXT_MESSAGE =
  "Esta operación todavía no es la siguiente en subirse. Fuerza la sincronización e inténtalo de nuevo.";

export type RevertOperation = {
  op: string;
  table: string;
  id: string;
  data: Record<string, unknown> | null;
};

export type RevertStep =
  | {
      table: string;
      id: string;
      action: "replace";
      data: Record<string, unknown>;
    }
  | { table: string; id: string; action: "delete" };

function rowKey(table: string, id: string) {
  return `${table}\u0000${id}`;
}

/**
 * How to undo the discarded operations in the local tables.
 *
 * Each row the discarded transaction touched starts again from the last
 * version the server sent (`serverRows`), or from nothing when the server
 * never sent it and the transaction created it. The operations still queued
 * after it are then replayed on that row, oldest first.
 *
 * A row the transaction changed but did not create, and that the server
 * never sent, is left as it is: it was created by an upload that has not come
 * back down yet, so its previous values are not on the device. The next
 * checkpoint puts it back in line with the server.
 */
export function planLocalRevert(input: {
  discarded: RevertOperation[];
  /** Operations still queued after the discarded ones, oldest first. */
  queued: RevertOperation[];
  /** Last server version of each row, keyed by table and id. */
  serverRows: ReadonlyMap<string, Record<string, unknown>>;
}): RevertStep[] {
  const firstOperations = new Map<string, RevertOperation>();
  for (const operation of input.discarded) {
    if (!syncedTables.has(operation.table)) continue;
    const key = rowKey(operation.table, operation.id);
    if (!firstOperations.has(key)) firstOperations.set(key, operation);
  }

  const steps: RevertStep[] = [];
  for (const [key, first] of firstOperations) {
    const serverRow = input.serverRows.get(key);
    if (!serverRow && first.op !== "PUT") continue;

    let row: Record<string, unknown> | null = serverRow
      ? { ...serverRow }
      : null;
    for (const operation of input.queued) {
      if (rowKey(operation.table, operation.id) !== key) continue;
      if (operation.op === "PUT") {
        row = { ...operation.data };
      } else if (operation.op === "PATCH") {
        row = row ? { ...row, ...operation.data } : null;
      } else if (operation.op === "DELETE") {
        row = null;
      }
    }

    steps.push(
      row
        ? { table: first.table, id: first.id, action: "replace", data: row }
        : { table: first.table, id: first.id, action: "delete" }
    );
  }
  return steps;
}

function operationFromCrudEntry(entry: CrudEntry): RevertOperation {
  return {
    op: entry.op,
    table: entry.table,
    id: entry.id,
    data: entry.opData ?? null,
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readServerRows(
  tx: Transaction,
  keys: { table: string; id: string }[]
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await tx.getAll<{
    row_type: string;
    row_id: string;
    data: string | null;
    op_id: number;
  }>(
    `SELECT row_type, row_id, data, op_id FROM ps_oplog
     WHERE (row_type, row_id) IN (
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
       FROM json_each(?)
     )`,
    [JSON.stringify(keys.map((key) => [key.table, key.id]))]
  );
  // The newest operation for a row wins, as when PowerSync applies it.
  const latest = new Map<string, { opId: number; data: string | null }>();
  for (const row of rows) {
    const key = rowKey(row.row_type, row.row_id);
    const current = latest.get(key);
    if (!current || Number(row.op_id) > current.opId) {
      latest.set(key, { opId: Number(row.op_id), data: row.data });
    }
  }
  const serverRows = new Map<string, Record<string, unknown>>();
  for (const [key, entry] of latest) {
    const data = parseJsonObject(entry.data);
    if (data) serverRows.set(key, data);
  }
  return serverRows;
}

async function readQueuedOperations(
  tx: Transaction,
  rowIds: string[]
): Promise<RevertOperation[]> {
  const rows = await tx.getAll<{ data: string }>(
    `SELECT data FROM ps_crud
     WHERE json_extract(data, '$.id') IN (SELECT value FROM json_each(?))
     ORDER BY id`,
    [JSON.stringify(rowIds)]
  );
  return rows.flatMap((row): RevertOperation[] => {
    const entry = parseJsonObject(row.data);
    if (
      !entry ||
      typeof entry.op !== "string" ||
      typeof entry.type !== "string" ||
      typeof entry.id !== "string"
    ) {
      return [];
    }
    return [
      {
        op: entry.op,
        table: entry.type,
        id: entry.id,
        data:
          entry.data && typeof entry.data === "object"
            ? (entry.data as Record<string, unknown>)
            : null,
      },
    ];
  });
}

async function revertLocalRows(
  tx: Transaction,
  discarded: RevertOperation[]
): Promise<number> {
  const keys = [
    ...new Map(
      discarded
        .filter((operation) => syncedTables.has(operation.table))
        .map((operation) => [
          rowKey(operation.table, operation.id),
          { table: operation.table, id: operation.id },
        ])
    ).values(),
  ];
  if (keys.length === 0) return 0;

  const steps = planLocalRevert({
    discarded,
    queued: await readQueuedOperations(
      tx,
      keys.map((key) => key.id)
    ),
    serverRows: await readServerRows(tx, keys),
  });

  for (const step of steps) {
    // step.table is one of SYNCED_TABLE_NAMES (planLocalRevert skips the
    // rest), so it is safe to name in the statement.
    if (step.action === "replace") {
      await tx.execute(
        `REPLACE INTO ps_data__${step.table} (id, data) VALUES (?, ?)`,
        [step.id, JSON.stringify(step.data)]
      );
    } else {
      await tx.execute(`DELETE FROM ps_data__${step.table} WHERE id = ?`, [
        step.id,
      ]);
    }
  }
  return steps.length;
}

async function markDiscarded(
  tx: Pick<Transaction, "execute">,
  failureId: string,
  now: string
) {
  await tx.execute(
    `UPDATE sync_failures
     SET discarded_at = ?, resolved_at = coalesce(resolved_at, ?)
     WHERE id = ?`,
    [now, now, failureId]
  );
}

export type DiscardSyncFailureResult = {
  /** False when the transaction had already left the queue. */
  removedFromQueue: boolean;
  /** Local rows put back to their server version (or removed). */
  revertedRows: number;
};

/**
 * Discards the failed transaction recorded as `failureId`. It must be the
 * next transaction in the upload queue, which a permanent failure always is,
 * since nothing behind it uploads. A marker without a transaction id whose
 * operations are no longer queued is only marked discarded.
 */
export async function discardSyncFailure(
  db: AbstractPowerSyncDatabase,
  failureId: string
): Promise<DiscardSyncFailureResult> {
  // A transaction that uploaded after all is resolved here, not discarded.
  await reconcileSyncFailures(db);
  const failure = await db.getOptional<{
    operations_json: string;
    error_code: string | null;
  }>(
    `SELECT operations_json, error_code FROM sync_failures
     WHERE id = ? AND resolved_at IS NULL`,
    [failureId]
  );
  if (!failure) {
    throw new SyncFailureDiscardError(SYNC_FAILURE_NOT_PENDING_MESSAGE);
  }
  const storedOperations = parseSyncFailureOperations(failure.operations_json);

  const head = await db.getNextCrudTransaction();
  const isHead =
    head != null &&
    syncFailureId({
      transactionId: head.transactionId,
      operations: head.crud,
    }) === failureId;

  let result: DiscardSyncFailureResult;
  if (isHead) {
    // Leave the queue first. If the revert below does not happen, the next
    // checkpoint still puts the rows back in line with the server, whereas a
    // revert without the dequeue would leave a queued upload the device no
    // longer shows.
    await head.complete();
    const discarded = head.crud.map(operationFromCrudEntry);
    const revertedRows = await db.writeTransaction(async (tx) => {
      const reverted = await revertLocalRows(tx, discarded);
      await markDiscarded(tx, failureId, new Date().toISOString());
      return reverted;
    });
    result = { removedFromQueue: true, revertedRows };
  } else {
    const stillQueued = await db.getOptional<{ queued: number }>(
      `SELECT 1 AS queued FROM ps_crud
       WHERE id IN (SELECT value FROM json_each(?))
       LIMIT 1`,
      [JSON.stringify(storedOperations.map((operation) => operation.clientId))]
    );
    if (stillQueued) {
      throw new SyncFailureDiscardError(SYNC_FAILURE_NOT_NEXT_MESSAGE);
    }
    // Nothing of it is queued any more, so only the marker is left. Whether
    // it reached the server is unknown, so the local rows are not touched.
    await markDiscarded(db, failureId, new Date().toISOString());
    result = { removedFromQueue: false, revertedRows: 0 };
  }

  try {
    reportDiscardedSyncFailure({
      errorCode: failure.error_code,
      operations: storedOperations,
      removedFromQueue: result.removedFromQueue,
    });
  } catch (reportingError) {
    console.error("[PowerSync] failed to report a discarded upload", {
      error: reportingError,
    });
  }
  return result;
}
