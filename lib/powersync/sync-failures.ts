import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";
import type { LocalRow, syncFailures } from "@/lib/db/client-schema";
import { reportSyncFailureReconciliationError } from "@/lib/observability/report-sync-failure";
import {
  errorDetails,
  syncFailureId,
  tenantIdFrom,
} from "@/lib/powersync/crud-metadata";

type SyncFailureRow = LocalRow<typeof syncFailures>;

export type SyncFailure = {
  id: string;
  transactionId: number | null;
  tenantId: string | null;
  operationsJson: string;
  errorCode: string | null;
  errorMessage: string;
  createdAt: string;
  /** Set when the transaction was discarded from Diagnostics. */
  discardedAt: string | null;
};

/** One operation of a failure's stored payload (CrudEntry.toJSON()). */
export type SyncFailureOperation = {
  clientId: number;
  op: string;
  table: string;
  id: string;
  data: Record<string, unknown> | null;
};

/** Reads a stored payload. Malformed entries are skipped. */
export function parseSyncFailureOperations(
  operationsJson: string
): SyncFailureOperation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(operationsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): SyncFailureOperation[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.op_id !== "number" ||
      typeof candidate.op !== "string" ||
      typeof candidate.type !== "string" ||
      typeof candidate.id !== "string"
    ) {
      return [];
    }
    return [
      {
        clientId: candidate.op_id,
        op: candidate.op,
        table: candidate.type,
        id: candidate.id,
        data:
          candidate.data && typeof candidate.data === "object"
            ? (candidate.data as Record<string, unknown>)
            : null,
      },
    ];
  });
}

/** What the failed transaction was, in the words the app uses for it. */
export function describeSyncFailure(operationsJson: string): string {
  const operations = parseSyncFailureOperations(operationsJson);
  const has = (table: string, op: string) =>
    operations.some(
      (operation) => operation.table === table && operation.op === op
    );
  if (has("sales", "PUT")) return "Venta";
  if (has("sales", "PATCH")) return "Anulación de venta";
  if (has("refunds", "PUT")) return "Reembolso";
  if (has("products", "PUT")) return "Producto nuevo";
  if (has("products", "PATCH")) return "Cambio de producto";
  if (has("inventory_movements", "PUT")) return "Movimiento de inventario";
  return "Operación";
}

export async function recordSyncFailure(
  db: AbstractPowerSyncDatabase,
  input: {
    transactionId?: number;
    operations: CrudEntry[];
    error: unknown;
  }
): Promise<void> {
  const details = errorDetails(input.error);
  const failureId = syncFailureId(input);
  await db.writeTransaction(async (tx) => {
    const existing = await tx.getOptional<
      Pick<SyncFailureRow, "created_at" | "resolved_at" | "discarded_at">
    >(
      `SELECT created_at, resolved_at, discarded_at FROM sync_failures
       WHERE id = ?`,
      [failureId]
    );
    // An upload already in flight when the transaction was discarded can
    // still fail afterwards. The discard stands.
    if (existing?.discarded_at) return;

    await tx.execute(`DELETE FROM sync_failures WHERE id = ?`, [failureId]);
    await tx.execute(
      `INSERT INTO sync_failures
        (id, transaction_id, tenant_id, operations_json, error_code,
         error_message, created_at, resolved_at, discarded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        failureId,
        input.transactionId ?? null,
        tenantIdFrom(input.operations),
        JSON.stringify(input.operations.map((operation) => operation.toJSON())),
        details.code,
        details.message,
        (existing && !existing.resolved_at ? existing.created_at : null) ??
          new Date().toISOString(),
      ]
    );
  });
}

export async function resolveSyncFailure(
  db: AbstractPowerSyncDatabase,
  input: { transactionId?: number; operations: CrudEntry[] }
): Promise<void> {
  await db.execute(
    `UPDATE sync_failures
     SET resolved_at = ?
     WHERE id = ? AND resolved_at IS NULL`,
    [new Date().toISOString(), syncFailureId(input)]
  );
}

type SyncFailureListRow = Omit<SyncFailureRow, "resolved_at">;

const syncFailureColumns = `id, transaction_id, tenant_id, operations_json,
  error_code, error_message, created_at, discarded_at`;

function toSyncFailure(row: SyncFailureListRow): SyncFailure {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    tenantId: row.tenant_id,
    operationsJson: row.operations_json,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    discardedAt: row.discarded_at,
  };
}

export async function getUnresolvedSyncFailures(
  db: AbstractPowerSyncDatabase
): Promise<SyncFailure[]> {
  const rows = await db.getAll<SyncFailureListRow>(
    `SELECT ${syncFailureColumns}
     FROM sync_failures
     WHERE resolved_at IS NULL
     ORDER BY created_at DESC`
  );
  return rows.map(toSyncFailure);
}

/** Discarded failures, kept with their payload until the data is cleared. */
export async function getDiscardedSyncFailures(
  db: AbstractPowerSyncDatabase
): Promise<SyncFailure[]> {
  const rows = await db.getAll<SyncFailureListRow>(
    `SELECT ${syncFailureColumns}
     FROM sync_failures
     WHERE discarded_at IS NOT NULL
     ORDER BY discarded_at DESC`
  );
  return rows.map(toSyncFailure);
}

export async function getUnresolvedSyncFailureCount(
  db: AbstractPowerSyncDatabase
): Promise<number> {
  const row = await db.getOptional<{ count: number }>(
    `SELECT count(*) AS count
     FROM sync_failures
     WHERE resolved_at IS NULL`
  );
  return Number(row?.count ?? 0);
}

/**
 * Clear dead-letter markers only after proving that their PowerSync CRUD
 * transaction is no longer queued. It only reads the queue; never call
 * complete() here, since reconciliation must not advance the queue.
 *
 * Markers without a transaction ID are intentionally retained: there is no
 * unambiguous queue identity with which to prove their completion.
 *
 * One query over ps_crud (PowerSync's upload queue table) finds which of
 * the markers' transactions are still queued. Walking the queue with
 * getCrudTransactions() instead costs a query per transaction, and the queue
 * keeps growing behind a failed transaction.
 */
export async function reconcileSyncFailures(
  db: AbstractPowerSyncDatabase
): Promise<number> {
  try {
    const markers = await db.getAll<
      Pick<SyncFailureRow, "id" | "transaction_id">
    >(
      `SELECT id, transaction_id FROM sync_failures
       WHERE resolved_at IS NULL AND transaction_id IS NOT NULL`
    );
    if (markers.length === 0) return 0;

    const queued = await db.getAll<{ tx_id: number }>(
      `SELECT DISTINCT tx_id FROM ps_crud
       WHERE tx_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(markers.map((marker) => marker.transaction_id))]
    );
    const queuedTransactionIds = new Set(
      queued.map((row) => Number(row.tx_id))
    );
    const staleIds = markers
      .filter(
        (marker) => !queuedTransactionIds.has(Number(marker.transaction_id))
      )
      .map((marker) => marker.id);
    if (staleIds.length === 0) return 0;

    await db.execute(
      `UPDATE sync_failures
       SET resolved_at = ?
       WHERE resolved_at IS NULL
         AND id IN (SELECT value FROM json_each(?))`,
      [new Date().toISOString(), JSON.stringify(staleIds)]
    );
    return staleIds.length;
  } catch (error) {
    // Do not expose SQL errors or operation payloads to telemetry.
    reportSyncFailureReconciliationError();
    throw error;
  }
}
