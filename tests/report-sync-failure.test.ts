import assert from "node:assert/strict";
import test from "node:test";
import type { CrudEntry } from "@powersync/web";
import {
  reportPermanentSyncFailure,
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
