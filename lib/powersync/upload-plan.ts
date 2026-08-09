import { type CrudEntry, UpdateType } from "@powersync/web";

type UploadRecord = Record<string, unknown> & { id: string };

export type UploadPlan =
  | {
      kind: "create-sale";
      sale: UploadRecord;
      lines: UploadRecord[];
    }
  | {
      kind: "void-sale";
      saleId: string;
      voidedByUserId: string;
      voidedAt: string;
    }
  | {
      kind: "create-refund";
      refund: UploadRecord;
    }
  | {
      kind: "single-operation";
      operation: CrudEntry;
    }
  | {
      kind: "multi-operation";
      operations: CrudEntry[];
    };

export class InvalidUploadTransactionError extends Error {
  readonly code = "INVALID_UPLOAD_TRANSACTION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidUploadTransactionError";
  }
}

function recordFor(operation: CrudEntry): UploadRecord {
  return { ...(operation.opData ?? {}), id: operation.id };
}

function isPut(operation: CrudEntry, table: string) {
  return operation.table === table && operation.op === UpdateType.PUT;
}

/**
 * Converts one local SQLite transaction into one remote atomic action.
 * Financial tables are deliberately fail-closed: an unfamiliar combination
 * can never fall through to separate PostgREST requests.
 */
export function createUploadPlan(operations: CrudEntry[]): UploadPlan {
  if (operations.length === 0) {
    throw new InvalidUploadTransactionError(
      "La transacción de subida está vacía."
    );
  }

  const saleCreates = operations.filter((operation) =>
    isPut(operation, "sales")
  );
  const lineCreates = operations.filter((operation) =>
    isPut(operation, "sale_lines")
  );

  if (
    saleCreates.length === 1 &&
    lineCreates.length >= 1 &&
    operations.length === saleCreates.length + lineCreates.length
  ) {
    const sale = recordFor(saleCreates[0]);
    const lines = lineCreates.map(recordFor);
    if (
      lines.some(
        (line) => typeof line.sale_id !== "string" || line.sale_id !== sale.id
      )
    ) {
      throw new InvalidUploadTransactionError(
        "Cada línea de venta debe referenciar la venta de su transacción de subida."
      );
    }
    return { kind: "create-sale", sale, lines };
  }

  if (
    operations.length === 1 &&
    operations[0].table === "sales" &&
    operations[0].op === UpdateType.PATCH
  ) {
    const operation = operations[0];
    const changedColumns = Object.keys(operation.opData ?? {}).sort();
    if (
      changedColumns.length !== 2 ||
      changedColumns[0] !== "voided_at" ||
      changedColumns[1] !== "voided_by_user_id" ||
      typeof operation.opData?.voided_by_user_id !== "string" ||
      typeof operation.opData?.voided_at !== "string"
    ) {
      throw new InvalidUploadTransactionError(
        "La actualización de una venta debe contener únicamente una transición de anulación completa."
      );
    }
    return {
      kind: "void-sale",
      saleId: operation.id,
      voidedByUserId: operation.opData.voided_by_user_id,
      voidedAt: operation.opData.voided_at,
    };
  }

  if (operations.length === 1 && isPut(operations[0], "refunds")) {
    return { kind: "create-refund", refund: recordFor(operations[0]) };
  }

  const touchesFinancialTable = operations.some((operation) =>
    ["sales", "sale_lines", "refunds"].includes(operation.table)
  );
  if (touchesFinancialTable) {
    throw new InvalidUploadTransactionError(
      "Las escrituras financieras deben corresponder a una transacción de subida atómica compatible."
    );
  }

  if (operations.length > 1) {
    return { kind: "multi-operation", operations };
  }

  return { kind: "single-operation", operation: operations[0] };
}
