import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { voidSaleLocal } from "@/lib/powersync/write-sales";
import { VOID_WINDOW_EXPIRED_MESSAGE, VOID_WINDOW_MS } from "@/lib/sales";

function saleDb(createdAt: string, writes: unknown[][]) {
  return {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        getAll: async (sql: string) =>
          /FROM sales/.test(sql)
            ? [
                {
                  created_at: createdAt,
                  voided_at: null,
                  tenant_id: "tenant-1",
                },
              ]
            : [],
        execute: async (_sql: string, params: unknown[]) => {
          writes.push(params);
          return { rowsAffected: 1 };
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
}

const input = { saleId: "sale-1", userId: "user-1", tenantId: "tenant-1" };

test("stamps the void with the instant the window was checked at", async () => {
  const writes: unknown[][] = [];
  const before = Date.now();

  await voidSaleLocal(saleDb(new Date(before).toISOString(), writes), input);

  assert.equal(writes.length, 1);
  const voidedAt = Date.parse(String(writes[0][0]));
  assert.ok(voidedAt >= before && voidedAt <= Date.now());
  assert.deepEqual(writes[0].slice(1), ["user-1", "sale-1"]);
});

test("rejects a void outside the shared window without writing", async () => {
  const writes: unknown[][] = [];
  const expired = new Date(Date.now() - VOID_WINDOW_MS - 1_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  await assert.rejects(voidSaleLocal(saleDb(expired, writes), input), {
    message: VOID_WINDOW_EXPIRED_MESSAGE,
  });
  await assert.rejects(voidSaleLocal(saleDb(future, writes), input), {
    message: VOID_WINDOW_EXPIRED_MESSAGE,
  });
  assert.equal(writes.length, 0);
});
