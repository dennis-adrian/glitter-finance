import assert from "node:assert/strict";
import test from "node:test";
import { type CrudEntry, UpdateType } from "@powersync/web";
import {
  createUploadPlan,
  InvalidUploadTransactionError,
} from "@/lib/powersync/upload-plan";
import { syncFailureId } from "@/lib/powersync/sync-failures";

function operation(input: {
  table: string;
  id: string;
  op: UpdateType;
  data?: Record<string, unknown>;
}): CrudEntry {
  return {
    table: input.table,
    id: input.id,
    op: input.op,
    opData: input.data,
  } as CrudEntry;
}

test("groups a sale and all of its lines into one atomic plan", () => {
  const sale = operation({
    table: "sales",
    id: "sale-1",
    op: UpdateType.PUT,
    data: { tenant_id: "tenant-1" },
  });
  const firstLine = operation({
    table: "sale_lines",
    id: "line-1",
    op: UpdateType.PUT,
    data: { sale_id: "sale-1", tenant_id: "tenant-1" },
  });
  const secondLine = operation({
    table: "sale_lines",
    id: "line-2",
    op: UpdateType.PUT,
    data: { sale_id: "sale-1", tenant_id: "tenant-1" },
  });

  const plan = createUploadPlan([sale, firstLine, secondLine]);

  assert.equal(plan.kind, "create-sale");
  if (plan.kind !== "create-sale") return;
  assert.equal(plan.sale.id, "sale-1");
  assert.deepEqual(
    plan.lines.map((line) => line.id),
    ["line-1", "line-2"]
  );
});

test("rejects a sale transaction containing a line for another sale", () => {
  const sale = operation({
    table: "sales",
    id: "sale-1",
    op: UpdateType.PUT,
  });
  const line = operation({
    table: "sale_lines",
    id: "line-1",
    op: UpdateType.PUT,
    data: { sale_id: "sale-2" },
  });

  assert.throws(
    () => createUploadPlan([sale, line]),
    InvalidUploadTransactionError
  );
});

test("routes only a complete void patch through the void RPC", () => {
  const plan = createUploadPlan([
    operation({
      table: "sales",
      id: "sale-1",
      op: UpdateType.PATCH,
      data: {
        voided_at: "2026-08-08T20:00:00.000Z",
        voided_by_user_id: "user-1",
      },
    }),
  ]);

  assert.deepEqual(plan, {
    kind: "void-sale",
    saleId: "sale-1",
    voidedByUserId: "user-1",
    voidedAt: "2026-08-08T20:00:00.000Z",
  });
});

test("routes a refund insert through the refund RPC", () => {
  const plan = createUploadPlan([
    operation({
      table: "refunds",
      id: "refund-1",
      op: UpdateType.PUT,
      data: { tenant_id: "tenant-1" },
    }),
  ]);

  assert.equal(plan.kind, "create-refund");
  if (plan.kind !== "create-refund") return;
  assert.equal(plan.refund.id, "refund-1");
});

test("fails closed for unsupported financial transactions", () => {
  assert.throws(
    () =>
      createUploadPlan([
        operation({
          table: "sale_lines",
          id: "line-1",
          op: UpdateType.PUT,
        }),
      ]),
    InvalidUploadTransactionError
  );
});

test("plans non-financial multi-row transactions as separate operations", () => {
  const operations = [
    operation({
      table: "products",
      id: "product-1",
      op: UpdateType.PATCH,
    }),
    operation({
      table: "inventory_movements",
      id: "movement-1",
      op: UpdateType.PUT,
    }),
  ];

  const plan = createUploadPlan(operations);

  assert.deepEqual(plan, { kind: "multi-operation", operations });
});

test("rejects inventory writes mixed into a sale transaction", () => {
  assert.throws(
    () =>
      createUploadPlan([
        operation({
          table: "sales",
          id: "sale-1",
          op: UpdateType.PUT,
        }),
        operation({
          table: "sale_lines",
          id: "line-1",
          op: UpdateType.PUT,
          data: { sale_id: "sale-1" },
        }),
        operation({
          table: "inventory_movements",
          id: "movement-1",
          op: UpdateType.PUT,
        }),
      ]),
    InvalidUploadTransactionError
  );
});

test("uses a stable failure id for retries of the same transaction", () => {
  const operations = [
    operation({
      table: "products",
      id: "product-1",
      op: UpdateType.PUT,
    }),
  ];

  assert.equal(
    syncFailureId({ transactionId: 42, operations }),
    "transaction:42"
  );
  assert.equal(
    syncFailureId({ transactionId: 42, operations }),
    "transaction:42"
  );
});
