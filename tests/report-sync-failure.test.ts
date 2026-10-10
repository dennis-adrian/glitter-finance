import assert from "node:assert/strict";
import test from "node:test";
import type { CrudEntry } from "@powersync/web";
import {
  permanentSyncFailureFingerprint,
  reportPermanentSyncFailure,
  reportUploadHeldByDeviceClock,
  resetReportedSyncFailures,
} from "@/lib/observability/report-sync-failure";

function operation(tenantId: string, clientId = 1): CrudEntry {
  return {
    clientId,
    opData: { tenant_id: tenantId },
  } as unknown as CrudEntry;
}

test("deduplicates sync failures within, but not across, tenants", () => {
  resetReportedSyncFailures();
  const error = { code: "23514" };

  assert.equal(
    reportPermanentSyncFailure({
      error,
      transactionId: 1,
      operations: [operation("tenant-a")],
    }),
    true
  );
  assert.equal(
    reportPermanentSyncFailure({
      error,
      transactionId: 1,
      operations: [operation("tenant-a")],
    }),
    false
  );
  assert.equal(
    reportPermanentSyncFailure({
      error,
      transactionId: 1,
      operations: [operation("tenant-b")],
    }),
    true
  );
  assert.equal(
    reportPermanentSyncFailure({
      error,
      operations: [operation("tenant-a", 2)],
    }),
    true
  );
  assert.equal(
    reportPermanentSyncFailure({
      error,
      operations: [operation("tenant-b", 2)],
    }),
    true
  );
});

test("reset clears reported sync failures", () => {
  resetReportedSyncFailures();
  const input = {
    error: { code: "23514" },
    transactionId: 1,
    operations: [operation("tenant-a")],
  };

  assert.equal(reportPermanentSyncFailure(input), true);
  assert.equal(reportPermanentSyncFailure(input), false);
  resetReportedSyncFailures();
  assert.equal(reportPermanentSyncFailure(input), true);
});

test("fingerprints permanent failures by code and upload target", () => {
  const operations = [
    { table: "sales", clientId: 1 },
    { table: "sale_lines", clientId: 2 },
  ] as unknown as CrudEntry[];

  assert.deepEqual(
    permanentSyncFailureFingerprint({
      error: { code: "23514" },
      operations,
      target: "powersync_create_sale",
    }),
    ["powersync-permanent-upload", "23514", "powersync_create_sale"]
  );
  assert.deepEqual(
    permanentSyncFailureFingerprint({ error: { code: "23514" }, operations }),
    ["powersync-permanent-upload", "23514", "sale_lines+sales"]
  );
  assert.deepEqual(
    permanentSyncFailureFingerprint({ error: new Error("x"), operations: [] }),
    ["powersync-permanent-upload", "unknown", "unknown"]
  );
});

test("a held upload is reported once per transaction, apart from failures", () => {
  resetReportedSyncFailures();
  const input = {
    transactionId: 1,
    operations: [operation("tenant-a")],
    target: "powersync_create_sale",
    heldUntil: "2026-09-28T23:55:00.000Z",
  };

  assert.equal(reportUploadHeldByDeviceClock(input), true);
  assert.equal(reportUploadHeldByDeviceClock(input), false);
  assert.equal(
    reportUploadHeldByDeviceClock({ ...input, transactionId: 2 }),
    true
  );
  // The same transaction can still fail permanently once the clock catches
  // up, and that failure is reported on its own.
  assert.equal(
    reportPermanentSyncFailure({
      error: { code: "23514" },
      transactionId: 1,
      operations: input.operations,
    }),
    true
  );
});
