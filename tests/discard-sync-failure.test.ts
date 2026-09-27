import assert from "node:assert/strict";
import test from "node:test";
import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  Transaction,
} from "@powersync/web";
import { UpdateType } from "@powersync/web";
import { getTableName } from "drizzle-orm";
import * as client from "@/lib/db/client-schema";
import {
  discardSyncFailure,
  planLocalRevert,
  SYNC_FAILURE_NOT_NEXT_MESSAGE,
  SYNC_FAILURE_NOT_PENDING_MESSAGE,
  SYNCED_TABLE_NAMES,
  type RevertOperation,
} from "@/lib/powersync/discard-sync-failure";

function key(table: string, id: string) {
  return `${table}\u0000${id}`;
}

function op(
  table: string,
  id: string,
  kind: "PUT" | "PATCH" | "DELETE",
  data: Record<string, unknown> | null = null
): RevertOperation {
  return { op: kind, table, id, data };
}

test("the revert covers exactly the synced tables", () => {
  const syncedClientTables = [
    client.products,
    client.sales,
    client.saleLines,
    client.refunds,
    client.tenantUsers,
    client.inventoryMovements,
  ].map((table) => getTableName(table));
  assert.deepEqual([...SYNCED_TABLE_NAMES].sort(), syncedClientTables.sort());
});

test("rows the discarded transaction created are removed", () => {
  const steps = planLocalRevert({
    discarded: [
      op("sales", "sale-1", "PUT", { total: 1 }),
      op("sale_lines", "line-1", "PUT", { sale_id: "sale-1" }),
    ],
    queued: [],
    serverRows: new Map(),
  });
  assert.deepEqual(steps, [
    { table: "sales", id: "sale-1", action: "delete" },
    { table: "sale_lines", id: "line-1", action: "delete" },
  ]);
});

test("a changed row goes back to the server version", () => {
  const steps = planLocalRevert({
    discarded: [
      op("sales", "sale-1", "PATCH", {
        voided_at: "2026-09-27T12:00:00.000Z",
        voided_by_user_id: "user-1",
      }),
    ],
    queued: [],
    serverRows: new Map([
      [key("sales", "sale-1"), { voided_at: null, payment_method: "cash" }],
    ]),
  });
  assert.deepEqual(steps, [
    {
      table: "sales",
      id: "sale-1",
      action: "replace",
      data: { voided_at: null, payment_method: "cash" },
    },
  ]);
});

test("changes still queued after the discarded one are kept", () => {
  const steps = planLocalRevert({
    discarded: [op("products", "product-1", "PATCH", { price_cents: -5 })],
    queued: [
      op("products", "product-1", "PATCH", { name: "Aretes dorados" }),
      op("products", "product-2", "PATCH", { name: "Otro" }),
    ],
    serverRows: new Map([
      [key("products", "product-1"), { name: "Aretes", price_cents: 500 }],
    ]),
  });
  assert.deepEqual(steps, [
    {
      table: "products",
      id: "product-1",
      action: "replace",
      data: { name: "Aretes dorados", price_cents: 500 },
    },
  ]);
});

test("a created row that later operations rebuilt is kept as they left it", () => {
  const steps = planLocalRevert({
    discarded: [op("products", "product-1", "PUT", { name: "A" })],
    queued: [op("products", "product-1", "PUT", { name: "B" })],
    serverRows: new Map(),
  });
  assert.deepEqual(steps, [
    {
      table: "products",
      id: "product-1",
      action: "replace",
      data: { name: "B" },
    },
  ]);
});

test("rows whose previous values the device never had are left alone", () => {
  const steps = planLocalRevert({
    discarded: [
      op("products", "product-1", "PATCH", { name: "X" }),
      op("draft_cart", "current", "PUT", { lines_json: "[]" }),
    ],
    queued: [],
    serverRows: new Map(),
  });
  assert.deepEqual(steps, []);
});

function crudEntry(
  clientId: number,
  table: string,
  id: string,
  kind: UpdateType,
  data?: Record<string, unknown>
): CrudEntry {
  return {
    clientId,
    table,
    id,
    op: kind,
    opData: data,
    transactionId: 9,
  } as unknown as CrudEntry;
}

function discardDb(input: {
  marker: { operations_json: string; error_code: string | null } | null;
  head: { transactionId?: number; crud: CrudEntry[] } | null;
  oplog?: { row_type: string; row_id: string; data: string; op_id: number }[];
  queuedCrud?: { data: string }[];
  stillQueued?: boolean;
}) {
  const events: string[] = [];
  const writes: { sql: string; params?: unknown[] }[] = [];
  const tx = {
    getAll: async (sql: string) => {
      if (/FROM ps_oplog/.test(sql)) return input.oplog ?? [];
      if (/FROM ps_crud/.test(sql)) return input.queuedCrud ?? [];
      throw new Error(`Unexpected read: ${sql}`);
    },
    execute: async (sql: string, params?: unknown[]) => {
      events.push("local-write");
      writes.push({ sql, params });
    },
  } as unknown as Transaction;
  const db = {
    // Reconciliation: no marker with a transaction id is stale.
    getAll: async () => [],
    getOptional: async (sql: string) => {
      if (/FROM sync_failures/.test(sql)) return input.marker;
      if (/FROM ps_crud/.test(sql)) {
        return input.stillQueued ? { queued: 1 } : null;
      }
      throw new Error(`Unexpected read: ${sql}`);
    },
    getNextCrudTransaction: async () =>
      input.head
        ? {
            ...input.head,
            complete: async () => {
              events.push("complete");
            },
          }
        : null,
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback(tx),
    execute: async (sql: string, params?: unknown[]) => {
      events.push("local-write");
      writes.push({ sql, params });
    },
  } as unknown as AbstractPowerSyncDatabase;
  return { db, events, writes };
}

const saleOperationsJson = JSON.stringify([
  { op_id: 3, op: "PUT", type: "sales", id: "sale-1", tx_id: 9, data: {} },
  {
    op_id: 4,
    op: "PUT",
    type: "sale_lines",
    id: "line-1",
    tx_id: 9,
    data: {},
  },
]);

test("discarding the failed head leaves the queue, then undoes it locally", async () => {
  const { db, events, writes } = discardDb({
    marker: { operations_json: saleOperationsJson, error_code: "23514" },
    head: {
      transactionId: 9,
      crud: [
        crudEntry(3, "sales", "sale-1", UpdateType.PUT, { tenant_id: "t" }),
        crudEntry(4, "sale_lines", "line-1", UpdateType.PUT, {
          sale_id: "sale-1",
        }),
      ],
    },
  });

  const result = await discardSyncFailure(db, "transaction:9");

  assert.deepEqual(result, { removedFromQueue: true, revertedRows: 2 });
  assert.equal(events[0], "complete");
  assert.match(writes[0].sql, /DELETE FROM ps_data__sales WHERE id = \?/);
  assert.deepEqual(writes[0].params, ["sale-1"]);
  assert.match(writes[1].sql, /DELETE FROM ps_data__sale_lines/);
  assert.match(writes[2].sql, /UPDATE sync_failures\s+SET discarded_at/);
  assert.equal(writes[2].params?.[2], "transaction:9");
});

test("a discarded change goes back to the version the server sent", async () => {
  const { db, writes } = discardDb({
    marker: {
      operations_json: JSON.stringify([
        { op_id: 7, op: "PATCH", type: "sales", id: "sale-1", data: {} },
      ]),
      error_code: "23514",
    },
    head: {
      transactionId: 9,
      crud: [
        crudEntry(7, "sales", "sale-1", UpdateType.PATCH, {
          voided_at: "2026-09-27T12:00:00.000Z",
        }),
      ],
    },
    oplog: [
      {
        row_type: "sales",
        row_id: "sale-1",
        data: JSON.stringify({ voided_at: null, v: 1 }),
        op_id: 10,
      },
      {
        row_type: "sales",
        row_id: "sale-1",
        data: JSON.stringify({ voided_at: null, v: 2 }),
        op_id: 12,
      },
    ],
  });

  await discardSyncFailure(db, "transaction:9");

  assert.match(writes[0].sql, /REPLACE INTO ps_data__sales \(id, data\)/);
  assert.deepEqual(writes[0].params, [
    "sale-1",
    JSON.stringify({ voided_at: null, v: 2 }),
  ]);
});

test("only a pending failure can be discarded", async () => {
  const { db, events } = discardDb({ marker: null, head: null });
  await assert.rejects(
    discardSyncFailure(db, "transaction:9"),
    new RegExp(SYNC_FAILURE_NOT_PENDING_MESSAGE)
  );
  assert.deepEqual(events, []);
});

test("a failure behind other queued work is not discarded", async () => {
  const { db, events } = discardDb({
    marker: { operations_json: saleOperationsJson, error_code: "23514" },
    head: {
      transactionId: 8,
      crud: [crudEntry(1, "products", "product-1", UpdateType.PUT)],
    },
    stillQueued: true,
  });
  await assert.rejects(
    discardSyncFailure(db, "operations:3-4"),
    (error: Error) => error.message === SYNC_FAILURE_NOT_NEXT_MESSAGE
  );
  assert.deepEqual(events, []);
});

test("a marker whose operations left the queue is only marked discarded", async () => {
  const { db, events, writes } = discardDb({
    marker: { operations_json: saleOperationsJson, error_code: null },
    head: null,
    stillQueued: false,
  });

  const result = await discardSyncFailure(db, "operations:3-4");

  assert.deepEqual(result, { removedFromQueue: false, revertedRows: 0 });
  assert.deepEqual(events, ["local-write"]);
  assert.match(writes[0].sql, /UPDATE sync_failures/);
});
