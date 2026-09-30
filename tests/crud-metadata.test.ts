import assert from "node:assert/strict";
import test from "node:test";
import type { CrudEntry } from "@powersync/web";
import {
  errorCode,
  errorDetails,
  syncFailureId,
  tenantIdFrom,
  uploadTablesLabel,
} from "@/lib/powersync/crud-metadata";

function operation(input: {
  clientId: number;
  table: string;
  tenantId?: unknown;
}): CrudEntry {
  return {
    clientId: input.clientId,
    table: input.table,
    opData:
      input.tenantId === undefined ? undefined : { tenant_id: input.tenantId },
  } as unknown as CrudEntry;
}

test("a failure is identified by its transaction, else by its operations", () => {
  const operations = [
    operation({ clientId: 4, table: "products" }),
    operation({ clientId: 5, table: "inventory_movements" }),
  ];

  assert.equal(
    syncFailureId({ transactionId: 9, operations }),
    "transaction:9"
  );
  assert.equal(syncFailureId({ operations }), "operations:4-5");
});

test("error codes are read from errors and plain objects alike", () => {
  const withCode = Object.assign(new Error("check violation"), {
    code: "23514",
  });

  assert.equal(errorCode(withCode), "23514");
  assert.equal(errorCode({ code: "PGRST202" }), "PGRST202");
  assert.equal(errorCode({ code: 42 }), null);
  assert.equal(errorCode("23514"), null);
  assert.deepEqual(errorDetails(withCode), {
    code: "23514",
    message: "check violation",
  });
  assert.deepEqual(errorDetails({ code: "42501" }), {
    code: "42501",
    message: "Permanent upload failure",
  });
  assert.deepEqual(errorDetails("offline"), {
    code: null,
    message: "offline",
  });
});

test("the tenant comes from the first operation that names one", () => {
  assert.equal(
    tenantIdFrom([
      operation({ clientId: 1, table: "sales" }),
      operation({ clientId: 2, table: "sales", tenantId: "" }),
      operation({ clientId: 3, table: "sales", tenantId: "tenant-a" }),
    ]),
    "tenant-a"
  );
  assert.equal(
    tenantIdFrom([operation({ clientId: 1, table: "sales", tenantId: 7 })]),
    null
  );
});

test("the tables label lists each table once, sorted", () => {
  assert.equal(
    uploadTablesLabel([
      { table: "products" },
      { table: "inventory_movements" },
      { table: "products" },
    ]),
    "inventory_movements+products"
  );
  assert.equal(uploadTablesLabel([]), "unknown");
});
