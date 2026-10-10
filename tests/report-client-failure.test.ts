import assert from "node:assert/strict";
import test from "node:test";
import {
  clientFailureDetails,
  reportClientFailure,
  resetReportedClientFailures,
} from "@/lib/observability/report-client-failure";

test("only the error name and code of a client failure are kept", () => {
  const sqliteError = Object.assign(
    new Error("UNIQUE constraint failed: products.id (tenant-1, Aretes)"),
    { name: "SqliteError", code: "SQLITE_CONSTRAINT" }
  );
  assert.deepEqual(clientFailureDetails(sqliteError), {
    name: "SqliteError",
    code: "SQLITE_CONSTRAINT",
  });
  assert.deepEqual(clientFailureDetails({ code: 23514 }), {
    name: "Error",
    code: "23514",
  });
  assert.deepEqual(clientFailureDetails(new TypeError("x is undefined")), {
    name: "TypeError",
    code: "unknown",
  });
});

test("names or codes that are not identifiers are dropped", () => {
  assert.deepEqual(
    clientFailureDetails({
      name: "Error: SELECT * FROM sales WHERE tenant_id = 'tenant-1'",
      code: "no such table: sales",
    }),
    { name: "Error", code: "unknown" }
  );
  assert.deepEqual(clientFailureDetails("database is locked"), {
    name: "Error",
    code: "unknown",
  });
  assert.deepEqual(clientFailureDetails(null), {
    name: "Error",
    code: "unknown",
  });
});

test("reports each component, name and code once per session", () => {
  resetReportedClientFailures();
  const error = Object.assign(new Error("disk I/O error"), {
    code: "SQLITE_IOERR",
  });

  assert.equal(reportClientFailure("powersync_products_watch", error), true);
  assert.equal(reportClientFailure("powersync_products_watch", error), false);
  assert.equal(reportClientFailure("powersync_inventory_watch", error), true);
  assert.equal(
    reportClientFailure("powersync_products_watch", new TypeError("boom")),
    true
  );

  resetReportedClientFailures();
  assert.equal(reportClientFailure("powersync_products_watch", error), true);
});
