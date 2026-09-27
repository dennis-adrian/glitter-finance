import assert from "node:assert/strict";
import test from "node:test";
import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  Transaction,
} from "@powersync/web";
import { UpdateType } from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseConnector,
  UnappliedUpdateError,
} from "@/lib/powersync/connector";

function operation(input: {
  clientId: number;
  table: string;
  id: string;
  op: UpdateType;
  data?: Record<string, unknown>;
}): CrudEntry {
  return {
    clientId: input.clientId,
    table: input.table,
    id: input.id,
    op: input.op,
    opData: input.data,
    toJSON: () => ({
      op_id: input.clientId,
      op: input.op,
      type: input.table,
      id: input.id,
      data: input.data,
    }),
  } as CrudEntry;
}

function saleTransaction() {
  return [
    operation({
      clientId: 1,
      table: "sales",
      id: "sale-1",
      op: UpdateType.PUT,
      data: { tenant_id: "tenant-1", user_id: "user-1" },
    }),
    operation({
      clientId: 2,
      table: "sale_lines",
      id: "line-1",
      op: UpdateType.PUT,
      data: { sale_id: "sale-1", tenant_id: "tenant-1" },
    }),
  ];
}

function emptySyncFailureState() {
  return {
    getAll: async () => [],
    getCrudTransactions: async function* () {},
  };
}

test("uploads a sale transaction through one RPC before completing", async () => {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const localWrites: string[] = [];
  const events: string[] = [];
  let completeCount = 0;
  const operations = saleTransaction();
  const supabase = {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      events.push("remote-commit");
      return { error: null };
    },
    from: () => {
      throw new Error("Financial transaction must not use table PostgREST.");
    },
  } as unknown as SupabaseClient;
  const db = {
    ...emptySyncFailureState(),
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 17,
      complete: async () => {
        completeCount += 1;
        events.push("complete");
      },
    }),
    execute: async (sql: string) => {
      localWrites.push(sql);
      events.push("resolve-marker");
    },
  } as unknown as AbstractPowerSyncDatabase;

  await new SupabaseConnector(supabase).uploadData(db);

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "powersync_create_sale");
  assert.match(localWrites[0], /UPDATE sync_failures/);
  assert.equal(completeCount, 1);
  assert.deepEqual(events, ["remote-commit", "complete", "resolve-marker"]);
});

test("uploads non-financial transaction operations sequentially", async () => {
  const events: string[] = [];
  const operations = [
    operation({
      clientId: 4,
      table: "products",
      id: "product-1",
      op: UpdateType.PATCH,
      data: { name: "Updated" },
    }),
    operation({
      clientId: 5,
      table: "inventory_movements",
      id: "movement-1",
      op: UpdateType.PUT,
      data: { product_id: "product-1", delta: 1 },
    }),
  ];
  const supabase = {
    from: (table: string) => ({
      update: () => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            events.push(`uploaded:${table}`);
            return { data: [{ id }], error: null };
          },
        }),
      }),
      insert: async () => {
        events.push(`uploaded:${table}`);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const db = {
    ...emptySyncFailureState(),
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 22,
      complete: async () => {
        events.push("complete");
      },
    }),
    execute: async () => {
      events.push("resolve-marker");
    },
  } as unknown as AbstractPowerSyncDatabase;

  await new SupabaseConnector(supabase).uploadData(db);

  assert.deepEqual(events, [
    "uploaded:products",
    "uploaded:inventory_movements",
    "complete",
    "resolve-marker",
  ]);
});

test("advances the queue when resolving a local failure marker fails", async () => {
  let completeCount = 0;
  let rpcCalls = 0;
  let resolutionAttempts = 0;
  const operations = saleTransaction();
  const supabase = {
    rpc: async () => {
      rpcCalls += 1;
      return { error: null };
    },
  } as unknown as SupabaseClient;
  const db = {
    getAll: async () => [
      {
        id: "transaction:20",
        transaction_id: 20,
        tenant_id: "tenant-1",
        operations_json: "[]",
        error_code: "23514",
        error_message: "Earlier permanent failure",
        created_at: "2026-08-09T00:00:00.000Z",
      },
    ],
    getCrudTransactions: async function* () {},
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 20,
      complete: async () => {
        completeCount += 1;
      },
    }),
    execute: async () => {
      resolutionAttempts += 1;
      if (resolutionAttempts === 1) {
        throw new Error("Local marker resolution failed");
      }
    },
  } as unknown as AbstractPowerSyncDatabase;

  await new SupabaseConnector(supabase).uploadData(db);

  assert.equal(completeCount, 1);
  assert.equal(rpcCalls, 1);
  assert.equal(resolutionAttempts, 2);
});

test("passes the local void timestamp to the atomic void RPC", async () => {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const operations = [
    operation({
      clientId: 3,
      table: "sales",
      id: "sale-1",
      op: UpdateType.PATCH,
      data: {
        voided_at: "2026-08-08T20:00:00.000Z",
        voided_by_user_id: "user-1",
      },
    }),
  ];
  const supabase = {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: "sale-1", error: null };
    },
  } as unknown as SupabaseClient;
  const db = {
    ...emptySyncFailureState(),
    writeTransaction: async () => {
      throw new Error("An applied void must not touch local rows.");
    },
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 21,
      complete: async () => undefined,
    }),
    execute: async () => undefined,
  } as unknown as AbstractPowerSyncDatabase;

  await new SupabaseConnector(supabase).uploadData(db);

  assert.deepEqual(rpcCalls, [
    {
      name: "powersync_void_sale",
      args: {
        sale_id: "sale-1",
        voided_by_user_id: "user-1",
        voided_at_value: "2026-08-08T20:00:00.000Z",
      },
    },
  ]);
});

test("reconciles a generated refund ID before completing", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const operations = [
    operation({
      clientId: 4,
      table: "refunds",
      id: "local-refund",
      op: UpdateType.PUT,
      data: { original_sale_id: "sale-1", tenant_id: "tenant-1" },
    }),
  ];
  const supabase = {
    rpc: async () => ({ data: "canonical-refund", error: null }),
  } as unknown as SupabaseClient;
  const db = {
    ...emptySyncFailureState(),
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 23,
      complete: async () => {
        events.push("complete");
      },
    }),
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        execute: async (sql: string, params?: unknown[]) => {
          localWrites.push({ sql, params });
          events.push("reconcile");
          return { rowsAffected: 1 };
        },
      } as unknown as Transaction),
    execute: async () => {
      events.push("resolve-marker");
    },
  } as unknown as AbstractPowerSyncDatabase;

  await new SupabaseConnector(supabase).uploadData(db);

  assert.equal(localWrites.length, 2);
  assert.match(localWrites[0].sql, /UPDATE OR IGNORE ps_data__refunds/);
  assert.deepEqual(localWrites[0].params, ["canonical-refund", "local-refund"]);
  assert.match(localWrites[1].sql, /DELETE FROM ps_data__refunds/);
  assert.deepEqual(events, [
    "reconcile",
    "reconcile",
    "complete",
    "resolve-marker",
  ]);
});

test("keeps a newly inserted refund unchanged", async () => {
  let reconciliationCount = 0;
  const operations = [
    operation({
      clientId: 5,
      table: "refunds",
      id: "new-refund",
      op: UpdateType.PUT,
      data: { original_sale_id: "sale-1", tenant_id: "tenant-1" },
    }),
  ];
  const supabase = {
    rpc: async () => ({ data: "new-refund", error: null }),
  } as unknown as SupabaseClient;
  const db = {
    ...emptySyncFailureState(),
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 24,
      complete: async () => undefined,
    }),
    writeTransaction: async () => {
      reconciliationCount += 1;
    },
    execute: async () => undefined,
  } as unknown as AbstractPowerSyncDatabase;

  await new SupabaseConnector(supabase).uploadData(db);

  assert.equal(reconciliationCount, 0);
});

test("records a permanent RPC failure and leaves the transaction queued", async () => {
  const localWrites: string[] = [];
  const localReads: string[] = [];
  let writeTransactionCount = 0;
  let completeCount = 0;
  const operations = saleTransaction();
  const permanentError = {
    code: "23514",
    message: "Injected invariant failure",
  };
  const supabase = {
    rpc: async () => ({ error: permanentError }),
  } as unknown as SupabaseClient;
  const db = {
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 18,
      complete: async () => {
        completeCount += 1;
      },
    }),
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) => {
      writeTransactionCount += 1;
      return callback({
        getOptional: async (sql: string) => {
          localReads.push(sql);
          return null;
        },
        execute: async (sql: string) => {
          localWrites.push(sql);
          return { rowsAffected: 1 };
        },
      } as unknown as Transaction);
    },
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(
    () => new SupabaseConnector(supabase).uploadData(db),
    permanentError
  );

  assert.equal(completeCount, 0);
  assert.equal(writeTransactionCount, 1);
  assert.match(localReads[0], /resolved_at IS NULL/);
  assert.equal(localWrites.length, 2);
  assert.match(localWrites[0], /DELETE FROM sync_failures/);
  assert.match(localWrites[1], /INSERT INTO sync_failures/);
  assert.doesNotMatch(localWrites[1], /ON CONFLICT/);
});

test("preserves the upload error when recording the failure also fails", async () => {
  let completeCount = 0;
  let recordingAttempts = 0;
  const operations = saleTransaction();
  const permanentError = {
    code: "23514",
    message: "Injected invariant failure",
  };
  const supabase = {
    rpc: async () => ({ error: permanentError }),
  } as unknown as SupabaseClient;
  const db = {
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 19,
      complete: async () => {
        completeCount += 1;
      },
    }),
    writeTransaction: async () => {
      recordingAttempts += 1;
      throw new Error("Local failure recording failed");
    },
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(
    () => new SupabaseConnector(supabase).uploadData(db),
    (error) => error === permanentError
  );

  assert.equal(completeCount, 0);
  assert.equal(recordingAttempts, 1);
});

function voidTransaction() {
  return [
    operation({
      clientId: 6,
      table: "sales",
      id: "sale-1",
      op: UpdateType.PATCH,
      data: {
        voided_at: "2026-08-08T20:00:00.000Z",
        voided_by_user_id: "user-1",
      },
    }),
  ];
}

function refundTransaction() {
  return [
    operation({
      clientId: 7,
      table: "refunds",
      id: "local-refund",
      op: UpdateType.PUT,
      data: { original_sale_id: "sale-1", tenant_id: "tenant-1" },
    }),
  ];
}

/** A db that records local writes made inside writeTransaction. */
function recordingDb(input: {
  crud: CrudEntry[];
  transactionId: number;
  events: string[];
  localWrites: { sql: string; params?: unknown[] }[];
}) {
  return {
    ...emptySyncFailureState(),
    getNextCrudTransaction: async () => ({
      crud: input.crud,
      transactionId: input.transactionId,
      complete: async () => {
        input.events.push("complete");
      },
    }),
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        getOptional: async () => null,
        execute: async (sql: string, params?: unknown[]) => {
          input.localWrites.push({ sql, params });
          input.events.push(
            /sync_failures/.test(sql) ? "record-failure" : "local-write"
          );
          return { rowsAffected: 1 };
        },
      } as unknown as Transaction),
    execute: async () => {
      input.events.push("resolve-marker");
    },
  } as unknown as AbstractPowerSyncDatabase;
}

function sessionAuth(session: object | null) {
  return {
    getSession: async () => ({ data: { session }, error: null }),
  };
}

test("reverts the local void when the server kept the sale for a refund", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const supabase = {
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient;
  const db = recordingDb({
    crud: voidTransaction(),
    transactionId: 30,
    events,
    localWrites,
  });

  await new SupabaseConnector(supabase).uploadData(db);

  assert.equal(localWrites.length, 1);
  assert.match(localWrites[0].sql, /UPDATE ps_data__sales/);
  assert.match(localWrites[0].sql, /json_remove\(data, '\$\.voided_at'/);
  assert.deepEqual(localWrites[0].params, ["sale-1"]);
  assert.deepEqual(events, ["local-write", "complete", "resolve-marker"]);
});

test("drops the local refund when the server had already voided the sale", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const supabase = {
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient;
  const db = recordingDb({
    crud: refundTransaction(),
    transactionId: 31,
    events,
    localWrites,
  });

  await new SupabaseConnector(supabase).uploadData(db);

  assert.equal(localWrites.length, 1);
  assert.match(localWrites[0].sql, /DELETE FROM ps_data__refunds/);
  assert.deepEqual(localWrites[0].params, ["local-refund"]);
  assert.deepEqual(events, ["local-write", "complete", "resolve-marker"]);
});

test("retries a future-timestamp rejection without recording a failure", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const clockError = {
    code: "55000",
    message:
      "The created_at timestamp is more than 5 minutes ahead of the server clock.",
  };
  const supabase = {
    rpc: async () => ({ data: null, error: clockError }),
  } as unknown as SupabaseClient;
  const db = recordingDb({
    crud: saleTransaction(),
    transactionId: 32,
    events,
    localWrites,
  });

  await assert.rejects(
    () => new SupabaseConnector(supabase).uploadData(db),
    (error) => error === clockError
  );

  assert.deepEqual(events, []);
});

test("treats a permission denial without a session as transient", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const denial = {
    code: "42501",
    message: "permission denied for function powersync_create_sale",
  };
  const supabase = {
    auth: sessionAuth(null),
    rpc: async () => ({ data: null, error: denial }),
  } as unknown as SupabaseClient;
  const db = recordingDb({
    crud: saleTransaction(),
    transactionId: 33,
    events,
    localWrites,
  });

  await assert.rejects(
    () => new SupabaseConnector(supabase).uploadData(db),
    (error) => error === denial
  );

  assert.deepEqual(events, []);
});

test("records a permission denial for a signed-in user", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const denial = {
    code: "42501",
    message: "The authenticated user cannot create this sale.",
  };
  const supabase = {
    auth: sessionAuth({ access_token: "token" }),
    rpc: async () => ({ data: null, error: denial }),
  } as unknown as SupabaseClient;
  const db = recordingDb({
    crud: saleTransaction(),
    transactionId: 34,
    events,
    localWrites,
  });

  await assert.rejects(
    () => new SupabaseConnector(supabase).uploadData(db),
    (error) => error === denial
  );

  assert.deepEqual(events, ["record-failure", "record-failure"]);
  assert.match(localWrites[1].sql, /INSERT INTO sync_failures/);
  assert.equal(localWrites[1].params?.[4], "42501");
});

test("records a missing RPC as a failure that says what to fix", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const missingRpc = {
    code: "PGRST202",
    message:
      "Could not find the function public.powersync_void_sale(sale_id, voided_at_value, voided_by_user_id) in the schema cache",
  };
  const supabase = {
    rpc: async () => ({ data: null, error: missingRpc }),
  } as unknown as SupabaseClient;
  const db = recordingDb({
    crud: voidTransaction(),
    transactionId: 35,
    events,
    localWrites,
  });

  await assert.rejects(
    () => new SupabaseConnector(supabase).uploadData(db),
    (error) => error === missingRpc
  );

  assert.deepEqual(events, ["record-failure", "record-failure"]);
  const [, , , , errorCodeParam, errorMessageParam] =
    localWrites[1].params ?? [];
  assert.equal(errorCodeParam, "PGRST202");
  assert.match(String(errorMessageParam), /powersync_void_sale/);
  assert.match(String(errorMessageParam), /SQL pendiente/);
});

test("records a product update that matched no row", async () => {
  const events: string[] = [];
  const localWrites: { sql: string; params?: unknown[] }[] = [];
  const supabase = {
    auth: sessionAuth({ access_token: "token" }),
    from: () => ({
      update: () => ({
        eq: () => ({
          select: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  const db = recordingDb({
    crud: [
      operation({
        clientId: 8,
        table: "products",
        id: "product-1",
        op: UpdateType.PATCH,
        data: { name: "Updated" },
      }),
    ],
    transactionId: 36,
    events,
    localWrites,
  });

  await assert.rejects(
    () => new SupabaseConnector(supabase).uploadData(db),
    (error) =>
      error instanceof UnappliedUpdateError &&
      error.code === "42501" &&
      /products/.test(error.message)
  );

  assert.deepEqual(events, ["record-failure", "record-failure"]);
});
