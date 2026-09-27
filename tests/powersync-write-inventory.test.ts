import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import {
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseSignedInteger,
  stockAmountError,
} from "@/components/screens/product-editor.helpers";
import { MAX_QUANTITY } from "@/lib/inventory";
import { addInventoryMovement } from "@/lib/powersync/write-inventory";
import { MAX_NOTE_LENGTH } from "@/lib/validation";

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

test("oversized deltas and notes are refused before they reach the queue", async () => {
  const { db, statements } = recordingDb();

  // 99999999999 overflows the Postgres integer column (22003), a permanent
  // upload failure that would block every later upload from the device.
  await assert.rejects(
    addInventoryMovement(db, {
      ...base,
      delta: 99_999_999_999,
      reason: "restock",
    }),
    /1\.000\.000/
  );
  await assert.rejects(
    addInventoryMovement(db, {
      ...base,
      delta: -(MAX_QUANTITY + 1),
      reason: "adjustment",
    }),
    /entero/
  );
  await assert.rejects(
    addInventoryMovement(db, {
      ...base,
      delta: -1,
      reason: "loss",
      note: "x".repeat(MAX_NOTE_LENGTH + 1),
    }),
    /nota/
  );
  assert.equal(statements.length, 0);

  await addInventoryMovement(db, {
    ...base,
    delta: MAX_QUANTITY,
    reason: "restock",
    note: "  caja nueva ",
  });
  assert.deepEqual(statements[0].params.slice(4, 7), [
    MAX_QUANTITY,
    "restock",
    "caja nueva",
  ]);
});

test("the initial stock field accepts 0 but not negatives or decimals", () => {
  assert.equal(parseNonNegativeInteger("0"), 0);
  assert.equal(parseNonNegativeInteger(" 12 "), 12);
  assert.equal(parseNonNegativeInteger("+3"), 3);
  assert.equal(parseNonNegativeInteger("-1"), null);
  assert.equal(parseNonNegativeInteger("1.5"), null);
  assert.equal(parseNonNegativeInteger("10 u"), null);
  assert.equal(parseNonNegativeInteger(""), null);
  assert.equal(parseNonNegativeInteger(String(MAX_QUANTITY)), MAX_QUANTITY);
  assert.equal(parseNonNegativeInteger(String(MAX_QUANTITY + 1)), null);
});

test("stock amount fields stay within the quantity bound", () => {
  assert.equal(parsePositiveInteger("5"), 5);
  assert.equal(parsePositiveInteger("0"), null);
  assert.equal(parsePositiveInteger("99999999999"), null);
  assert.equal(parseSignedInteger("-3"), -3);
  assert.equal(parseSignedInteger(`-${MAX_QUANTITY}`), -MAX_QUANTITY);
  assert.equal(parseSignedInteger(`-${MAX_QUANTITY + 1}`), null);
  assert.equal(parseSignedInteger("0"), null);

  assert.equal(stockAmountError(""), null);
  assert.equal(stockAmountError("-", true), null);
  assert.equal(stockAmountError("12"), null);
  assert.match(stockAmountError("99999999999") ?? "", /1\.000\.000/);
  assert.match(stockAmountError("1,5") ?? "", /entero/);
  assert.equal(stockAmountError("-2", true), null);
  assert.match(stockAmountError("0", true) ?? "", /distinto de cero/);
});
