import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { parseNonNegativeInteger } from "@/components/screens/product-editor.helpers";
import { addInventoryMovement } from "@/lib/powersync/write-inventory";

function recordingDb() {
  const statements: { sql: string; params: unknown[] }[] = [];
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        execute: async (sql: string, params: unknown[] = []) => {
          statements.push({ sql, params });
        },
        getAll: async () => {
          throw new Error("unexpected read");
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, statements };
}

const base = {
  tenantId: "tenant-1",
  userId: "user-1",
  productId: "product-1",
};

test("a zero initial is written, and a second initial is not blocked", async () => {
  const { db, statements } = recordingDb();

  await addInventoryMovement(db, { ...base, delta: 0, reason: "initial" });
  await addInventoryMovement(db, { ...base, delta: 8, reason: "initial" });

  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /INSERT INTO inventory_movements/);
  assert.deepEqual(statements[0].params.slice(4, 6), [0, "initial"]);
  assert.deepEqual(statements[1].params.slice(4, 6), [8, "initial"]);
});

test("deltas Postgres would reject never reach the upload queue", async () => {
  const { db, statements } = recordingDb();

  await assert.rejects(
    addInventoryMovement(db, { ...base, delta: -1, reason: "initial" }),
    /stock inicial/
  );
  await assert.rejects(
    addInventoryMovement(db, { ...base, delta: -2, reason: "restock" }),
    /entero/
  );
  await assert.rejects(
    addInventoryMovement(db, { ...base, delta: 3, reason: "loss" }),
    /entero/
  );
  await assert.rejects(
    addInventoryMovement(db, { ...base, delta: 0, reason: "adjustment" }),
    /entero/
  );
  assert.equal(statements.length, 0);
});

test("the initial stock field accepts 0 but not negatives or decimals", () => {
  assert.equal(parseNonNegativeInteger("0"), 0);
  assert.equal(parseNonNegativeInteger(" 12 "), 12);
  assert.equal(parseNonNegativeInteger("+3"), 3);
  assert.equal(parseNonNegativeInteger("-1"), null);
  assert.equal(parseNonNegativeInteger("1.5"), null);
  assert.equal(parseNonNegativeInteger("10 u"), null);
  assert.equal(parseNonNegativeInteger(""), null);
});
