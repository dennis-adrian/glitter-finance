// What the app reads from a PowerSync upload transaction and its error,
// shared by the local failure markers (lib/powersync/sync-failures.ts), the
// upload connector and the Sentry reports
// (lib/observability/report-sync-failure.ts). It imports nothing at runtime:
// sync-failures.ts already imports the reports, so neither can hold these
// helpers for the other.

import type { CrudEntry } from "@powersync/web";

/**
 * The id of a failed upload's local marker: its transaction, or the client
 * ids of its operations when PowerSync gave no transaction id.
 */
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

/** The SQLSTATE or PostgREST code an upload error carries, if any. */
export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function errorDetails(error: unknown): {
  code: string | null;
  message: string;
} {
  if (error instanceof Error) {
    return { code: errorCode(error), message: error.message };
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    return {
      code: errorCode(error),
      message:
        typeof message === "string" ? message : "Permanent upload failure",
    };
  }
  return { code: null, message: String(error) };
}

/** The tenant the operations were written for, from their row data. */
export function tenantIdFrom(operations: CrudEntry[]): string | null {
  for (const operation of operations) {
    const tenantId = operation.opData?.tenant_id;
    if (typeof tenantId === "string" && tenantId) {
      return tenantId;
    }
  }
  return null;
}

/** The tables the operations touch, sorted and joined with "+". */
export function uploadTablesLabel(
  operations: readonly { table: string }[]
): string {
  const tables = [
    ...new Set(
      operations
        .map((operation) => operation.table)
        .filter((table): table is string => typeof table === "string")
    ),
  ].sort();
  return tables.length ? tables.join("+") : "unknown";
}
