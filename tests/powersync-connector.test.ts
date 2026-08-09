import assert from "node:assert/strict";
import test from "node:test";
import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  Transaction,
} from "@powersync/web";
import { UpdateType } from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseConnector } from "@/lib/powersync/connector";

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

test("uploads a sale transaction through one RPC before completing", async () => {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const localWrites: string[] = [];
  let completeCount = 0;
  const operations = saleTransaction();
  const supabase = {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { error: null };
    },
    from: () => {
      throw new Error("Financial transaction must not use table PostgREST.");
    },
  } as unknown as SupabaseClient;
  const db = {
    getNextCrudTransaction: async () => ({
      crud: operations,
      transactionId: 17,
      complete: async () => {
        completeCount += 1;
      },
    }),
    execute: async (sql: string) => {
      localWrites.push(sql);
    },
  } as unknown as AbstractPowerSyncDatabase;

  await new SupabaseConnector(supabase).uploadData(db);

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "powersync_create_sale");
  assert.match(localWrites[0], /UPDATE sync_failures/);
  assert.equal(completeCount, 1);
});

test("records a permanent RPC failure and leaves the transaction queued", async () => {
  const localWrites: string[] = [];
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
        getOptional: async () => null,
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
