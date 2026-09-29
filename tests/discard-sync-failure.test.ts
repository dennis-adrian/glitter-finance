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
import {
  getDiscardedSyncFailures,
  getUnresolvedSyncFailures,
  reconcileSyncFailures,
} from "@/lib/powersync/sync-failures";

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

type FakeMarker = {
  id: string;
  transaction_id: number | null;
  operations_json: string;
  error_code: string | null;
  resolved_at: string | null;
  discarded_at: string | null;
};

/**
 * A database with one failure record and an upload queue whose head is
 * `head`. SQL is recognised by shape, as the discard issues it; `failOn`
 * makes the matching statement throw, like a storage error.
 */
function discardDb(input: {
  marker: Omit<FakeMarker, "resolved_at" | "discarded_at"> | null;
  head: { transactionId?: number; crud: CrudEntry[] } | null;
  oplog?: { row_type: string; row_id: string; data: string; op_id: number }[];
  queuedCrud?: { data: string }[];
  stillQueued?: boolean;
  failOn?: RegExp;
  completeError?: Error;
  /** Runs inside complete(), as an upload finishing at that moment would. */
  duringComplete?: (marker: FakeMarker) => void;
}) {
  const marker: FakeMarker | null = input.marker
    ? { ...input.marker, resolved_at: null, discarded_at: null }
    : null;
  let headQueued = input.head != null;
  const events: string[] = [];
  const rowWrites: { sql: string; params?: unknown[] }[] = [];

  function check(sql: string) {
    if (input.failOn?.test(sql)) throw new Error("disk I/O error");
  }
  function markerRow() {
    return marker
      ? {
          ...marker,
          tenant_id: "tenant-1",
          error_message: "rejected",
          created_at: "2026-09-27T12:00:00.000Z",
        }
      : null;
  }

  async function getOptional(sql: string, params: unknown[] = []) {
    check(sql);
    if (/FROM sync_failures/.test(sql)) {
      if (!marker || params[0] !== marker.id) return null;
      if (/resolved_at IS NULL/.test(sql) && marker.resolved_at) return null;
      return markerRow();
    }
    if (/FROM ps_crud/.test(sql)) {
      return input.stillQueued ? { queued: 1 } : null;
    }
    throw new Error(`Unexpected read: ${sql}`);
  }

  async function getAll(sql: string, params: unknown[] = []) {
    check(sql);
    if (/FROM ps_oplog/.test(sql)) return input.oplog ?? [];
    if (/SELECT data FROM ps_crud/.test(sql)) return input.queuedCrud ?? [];
    if (/SELECT DISTINCT tx_id FROM ps_crud/.test(sql)) {
      const ids = JSON.parse(String(params[0])) as number[];
      const queuedId = headQueued ? input.head?.transactionId : undefined;
      return queuedId != null && ids.includes(queuedId)
        ? [{ tx_id: queuedId }]
        : [];
    }
    if (/FROM sync_failures/.test(sql)) {
      const row = markerRow();
      if (!marker || !row) return [];
      if (/transaction_id IS NOT NULL/.test(sql)) {
        return !marker.resolved_at && marker.transaction_id != null
          ? [row]
          : [];
      }
      if (/discarded_at IS NOT NULL AND resolved_at IS NOT NULL/.test(sql)) {
        return marker.discarded_at && marker.resolved_at ? [row] : [];
      }
      if (/WHERE resolved_at IS NULL/.test(sql)) {
        return marker.resolved_at ? [] : [row];
      }
    }
    throw new Error(`Unexpected read: ${sql}`);
  }

  async function execute(sql: string, params: unknown[] = []) {
    check(sql);
    if (/ps_data__/.test(sql)) {
      events.push("revert");
      rowWrites.push({ sql, params });
      return;
    }
    if (!marker) throw new Error(`Unexpected write: ${sql}`);
    if (/SET discarded_at = NULL/.test(sql)) {
      events.push("withdraw");
      if (!marker.resolved_at) marker.discarded_at = null;
    } else if (
      /SET discarded_at = coalesce\(discarded_at, \?\)\s+WHERE/.test(sql)
    ) {
      events.push("decide");
      marker.discarded_at ??= String(params[0]);
    } else if (/SET resolved_at = coalesce\(resolved_at, \?\)/.test(sql)) {
      events.push("resolve");
      marker.resolved_at ??= String(params[0]);
    } else if (/AND id IN \(SELECT value FROM json_each/.test(sql)) {
      // reconcileSyncFailures
      const ids = JSON.parse(String(params[1])) as string[];
      if (!marker.resolved_at && ids.includes(marker.id)) {
        marker.resolved_at = String(params[0]);
      }
    } else {
      throw new Error(`Unexpected write: ${sql}`);
    }
  }

  const tx = { getOptional, getAll, execute } as unknown as Transaction;
  const db = {
    getOptional,
    getAll,
    execute,
    getNextCrudTransaction: async () =>
      input.head && headQueued
        ? {
            ...input.head,
            complete: async () => {
              events.push("complete");
              if (input.completeError) throw input.completeError;
              headQueued = false;
              if (marker) input.duringComplete?.(marker);
            },
          }
        : null,
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback(tx),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, events, rowWrites, marker: () => marker };
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

const saleMarker = {
  id: "transaction:9",
  transaction_id: 9,
  operations_json: saleOperationsJson,
  error_code: "23514",
};

const saleHead = {
  transactionId: 9,
  crud: [
    crudEntry(3, "sales", "sale-1", UpdateType.PUT, { tenant_id: "t" }),
    crudEntry(4, "sale_lines", "line-1", UpdateType.PUT, {
      sale_id: "sale-1",
    }),
  ],
};

test("a discard is recorded, leaves the queue, then undoes it locally", async () => {
  const { db, events, rowWrites, marker } = discardDb({
    marker: saleMarker,
    head: saleHead,
  });

  const result = await discardSyncFailure(db, "transaction:9");

  assert.deepEqual(result, {
    removedFromQueue: true,
    revertedRows: 2,
    revertFailed: false,
  });
  assert.deepEqual(events, [
    "decide",
    "complete",
    "resolve",
    "revert",
    "revert",
  ]);
  assert.match(rowWrites[0].sql, /DELETE FROM ps_data__sales WHERE id = \?/);
  assert.deepEqual(rowWrites[0].params, ["sale-1"]);
  assert.match(rowWrites[1].sql, /DELETE FROM ps_data__sale_lines/);
  assert.ok(marker()?.discarded_at);
  assert.ok(marker()?.resolved_at);
  assert.equal((await getDiscardedSyncFailures(db)).length, 1);
  assert.equal((await getUnresolvedSyncFailures(db)).length, 0);
});

test("a discard interrupted after leaving the queue is still listed as discarded", async () => {
  const { db, events, marker } = discardDb({
    marker: saleMarker,
    head: saleHead,
    failOn: /SET resolved_at = coalesce/,
  });

  await assert.rejects(discardSyncFailure(db, "transaction:9"), /disk I\/O/);
  assert.deepEqual(events, ["decide", "complete"]);
  assert.ok(marker()?.discarded_at);

  // The next status refresh finds the transaction gone from the queue.
  assert.equal(await reconcileSyncFailures(db), 1);
  const discarded = await getDiscardedSyncFailures(db);
  assert.deepEqual(
    discarded.map((failure) => [failure.id, failure.operationsJson]),
    [["transaction:9", saleOperationsJson]]
  );
  assert.equal((await getUnresolvedSyncFailures(db)).length, 0);
});

test("a discard whose local undo fails still stands", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  const { db, events, rowWrites, marker } = discardDb({
    marker: saleMarker,
    head: saleHead,
    failOn: /FROM ps_oplog/,
  });

  const result = await discardSyncFailure(db, "transaction:9");

  assert.deepEqual(result, {
    removedFromQueue: true,
    revertedRows: 0,
    revertFailed: true,
  });
  assert.deepEqual(events, ["decide", "complete", "resolve"]);
  assert.deepEqual(rowWrites, []);
  assert.equal(consoleError.mock.callCount(), 1);
  assert.ok(marker()?.discarded_at && marker()?.resolved_at);
  assert.equal((await getDiscardedSyncFailures(db)).length, 1);
});

test("a discard whose dequeue fails leaves a pending failure", async () => {
  const { db, events, marker } = discardDb({
    marker: saleMarker,
    head: saleHead,
    completeError: new Error("database is locked"),
  });

  await assert.rejects(discardSyncFailure(db, "transaction:9"), /locked/);
  assert.deepEqual(events, ["decide", "complete", "withdraw"]);
  assert.equal(marker()?.discarded_at, null);
  assert.equal(marker()?.resolved_at, null);
  assert.equal((await getUnresolvedSyncFailures(db)).length, 1);
  assert.equal((await getDiscardedSyncFailures(db)).length, 0);
});

test("a decision left by an interrupted discard is carried through", async () => {
  const { db, events, marker } = discardDb({
    marker: saleMarker,
    head: saleHead,
  });
  // The earlier attempt recorded the decision, then the app closed.
  marker()!.discarded_at = "2026-09-27T12:05:00.000Z";
  assert.equal((await getUnresolvedSyncFailures(db)).length, 1);
  assert.equal((await getDiscardedSyncFailures(db)).length, 0);

  await discardSyncFailure(db, "transaction:9");

  assert.deepEqual(events.slice(0, 3), ["decide", "complete", "resolve"]);
  assert.equal(marker()?.discarded_at, "2026-09-27T12:05:00.000Z");
  assert.ok(marker()?.resolved_at);
});

test("a transaction that uploaded while it was discarded is not reported discarded", async () => {
  const { db, events, rowWrites } = discardDb({
    marker: saleMarker,
    head: saleHead,
    // resolveSyncFailure, after the upload in flight got through.
    duringComplete: (current) => {
      current.resolved_at = "2026-09-27T12:06:00.000Z";
      current.discarded_at = null;
    },
  });

  await assert.rejects(
    discardSyncFailure(db, "transaction:9"),
    (error: Error) => error.message === SYNC_FAILURE_NOT_PENDING_MESSAGE
  );
  assert.deepEqual(events, ["decide", "complete"]);
  assert.deepEqual(rowWrites, []);
  assert.equal((await getDiscardedSyncFailures(db)).length, 0);
});

test("a discarded change goes back to the version the server sent", async () => {
  const { db, rowWrites } = discardDb({
    marker: {
      ...saleMarker,
      operations_json: JSON.stringify([
        { op_id: 7, op: "PATCH", type: "sales", id: "sale-1", data: {} },
      ]),
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

  assert.match(rowWrites[0].sql, /REPLACE INTO ps_data__sales \(id, data\)/);
  assert.deepEqual(rowWrites[0].params, [
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
  const { db, events, marker } = discardDb({
    marker: { ...saleMarker, id: "operations:3-4", transaction_id: null },
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
  assert.equal(marker()?.discarded_at, null);
});

test("a marker whose operations left the queue is only marked discarded", async () => {
  const { db, events, marker } = discardDb({
    marker: {
      ...saleMarker,
      id: "operations:3-4",
      transaction_id: null,
      error_code: null,
    },
    head: null,
    stillQueued: false,
  });

  const result = await discardSyncFailure(db, "operations:3-4");

  assert.deepEqual(result, {
    removedFromQueue: false,
    revertedRows: 0,
    revertFailed: false,
  });
  assert.deepEqual(events, ["decide", "resolve"]);
  assert.ok(marker()?.discarded_at && marker()?.resolved_at);
});
