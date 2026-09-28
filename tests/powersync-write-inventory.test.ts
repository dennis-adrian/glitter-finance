import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import {
  initialStockHint,
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseSignedInteger,
  stockAmountError,
} from "@/components/screens/product-editor.helpers";
import { MAX_QUANTITY, resolveInitialStockDelta } from "@/lib/inventory";
import {
  addInventoryMovement,
  initialMovementStateLocal,
} from "@/lib/powersync/write-inventory";
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

test("no local initial is unknown until the first sync has completed", async () => {
  const store = (hasSynced: boolean | undefined, initialIds: string[]) => ({
    currentStatus: { hasSynced } as AbstractPowerSyncDatabase["currentStatus"],
    getAll: (async (sql: string, params: unknown[] = []) => {
      assert.match(sql, /reason = 'initial'/);
      assert.deepEqual(params, ["product-1"]);
      return initialIds.map((id) => ({ id }));
    }) as AbstractPowerSyncDatabase["getAll"],
  });

  // This device's own count is on the store from the start.
  assert.equal(
    await initialMovementStateLocal(store(false, ["m1"]), "product-1"),
    "recorded"
  );
  assert.equal(
    await initialMovementStateLocal(store(true, ["m1"]), "product-1"),
    "recorded"
  );
  assert.equal(
    await initialMovementStateLocal(store(true, []), "product-1"),
    "none"
  );
  // Another device's count may not have arrived yet.
  assert.equal(
    await initialMovementStateLocal(store(false, []), "product-1"),
    "unknown"
  );
  assert.equal(
    await initialMovementStateLocal(store(undefined, []), "product-1"),
    "unknown"
  );
});

test("the initial-stock hint promises a 0 only when a blank field records one", () => {
  for (const wasTrackingInventory of [false, true]) {
    for (const initialMovement of ["none", "recorded", "unknown"] as const) {
      const context = { wasTrackingInventory, initialMovement };
      const blankRecordsZero =
        resolveInitialStockDelta({ ...context, tracksInventory: true }) === 0;
      assert.equal(
        /vacío, empieza en 0/.test(initialStockHint(context)),
        blankRecordsZero,
        JSON.stringify(context)
      );
    }
  }
  assert.match(
    initialStockHint({
      wasTrackingInventory: false,
      initialMovement: "recorded",
    }),
    /sigue el conteo anterior/
  );
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
