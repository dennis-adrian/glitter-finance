import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleQueryError } from "drizzle-orm";
import { postgresErrorCode } from "@/lib/db/errors";
import { validateInventoryMovement } from "@/lib/inventory";

test("inventory movements follow the database sign rules", () => {
  assert.doesNotThrow(() => validateInventoryMovement(5, "initial"));
  assert.doesNotThrow(() => validateInventoryMovement(3, "restock"));
  assert.doesNotThrow(() => validateInventoryMovement(-2, "adjustment"));
  assert.doesNotThrow(() => validateInventoryMovement(-1, "loss"));
  assert.doesNotThrow(() => validateInventoryMovement(-1, "gift"));

  assert.throws(() => validateInventoryMovement(-5, "initial"), /mayor que cero/);
  assert.throws(() => validateInventoryMovement(-1, "restock"), /mayor que cero/);
  assert.throws(() => validateInventoryMovement(1, "loss"), /restar unidades/);
  assert.throws(() => validateInventoryMovement(0, "adjustment"), /distinto de cero/);
  assert.throws(() => validateInventoryMovement(1.5, "restock"), /entero/);
  assert.throws(() => validateInventoryMovement(1, "theft"), /motivo/);
});

test("reads the Postgres error code through Drizzle's query wrapper", () => {
  const driverError = Object.assign(new Error("duplicate key"), {
    code: "23505",
  });

  assert.equal(postgresErrorCode(driverError), "23505");
  assert.equal(
    postgresErrorCode(new DrizzleQueryError("INSERT ...", [], driverError)),
    "23505"
  );
  assert.equal(postgresErrorCode(new Error("plain")), null);
  assert.equal(postgresErrorCode(null), null);
});
