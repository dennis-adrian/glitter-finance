import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleQueryError } from "drizzle-orm";
import { postgresErrorCode } from "@/lib/db/errors";

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
