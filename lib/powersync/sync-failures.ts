import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";
import type { LocalRow, syncFailures } from "@/lib/db/client-schema";
import { reportSyncFailureReconciliationError } from "@/lib/observability/report-sync-failure";

type SyncFailureRow = LocalRow<typeof syncFailures>;

export type SyncFailure = {
  id: string;
  transactionId: number | null;
  tenantId: string | null;
  operationsJson: string;
  errorCode: string | null;
  errorMessage: string;
  createdAt: string;
};

export function syncFailureId(input: {
  transactionId?: number;
  operations: CrudEntry[];
}): string {
  if (input.transactionId != null) {
    return `transaction:${input.transactionId}`;
  }
  return `operations:${input.operations
    .map((operation) => operation.clientId)
    .join("-")}`;
}

function errorDetails(error: unknown): {
  code: string | null;
  message: string;
} {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      code: typeof code === "string" ? code : null,
      message: error.message,
    };
  }
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : null,
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Permanent upload failure",
    };
  }
  return { code: null, message: String(error) };
}

function tenantIdFrom(operations: CrudEntry[]): string | null {
  for (const operation of operations) {
    const tenantId = operation.opData?.tenant_id;
    if (typeof tenantId === "string" && tenantId) {
      return tenantId;
    }
  }
  return null;
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
    const existing = await tx.getOptional<{ created_at: string }>(
      `SELECT created_at FROM sync_failures
       WHERE id = ? AND resolved_at IS NULL`,
      [failureId]
    );

    await tx.execute(`DELETE FROM sync_failures WHERE id = ?`, [failureId]);
    await tx.execute(
      `INSERT INTO sync_failures
        (id, transaction_id, tenant_id, operations_json, error_code,
         error_message, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        failureId,
        input.transactionId ?? null,
        tenantIdFrom(input.operations),
        JSON.stringify(input.operations.map((operation) => operation.toJSON())),
        details.code,
        details.message,
        existing?.created_at ?? new Date().toISOString(),
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

export async function getUnresolvedSyncFailures(
  db: AbstractPowerSyncDatabase
): Promise<SyncFailure[]> {
  const rows = await db.getAll<Omit<SyncFailureRow, "resolved_at">>(
    `SELECT id, transaction_id, tenant_id, operations_json, error_code,
            error_message, created_at
     FROM sync_failures
     WHERE resolved_at IS NULL
     ORDER BY created_at DESC`
  );

  return rows.map((row) => ({
    id: row.id,
    transactionId: row.transaction_id,
    tenantId: row.tenant_id,
    operationsJson: row.operations_json,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }));
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
