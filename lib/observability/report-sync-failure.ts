import * as Sentry from "@sentry/nextjs";
import type { CrudEntry } from "@powersync/web";

const reportedFailures = new Set<string>();
const telemetryFlushTimeoutMs = 2_000;

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "unknown";
}

function tenantIdFrom(operations: CrudEntry[]): string {
  for (const operation of operations) {
    const tenantId = operation.opData?.tenant_id;
    if (typeof tenantId === "string" && tenantId) return tenantId;
  }
  return "unknown";
}

export function resetReportedSyncFailures() {
  reportedFailures.clear();
}

/** Report metadata only. Financial row data and tenant/user identifiers stay local. */
export function reportPermanentSyncFailure(input: {
  error: unknown;
  transactionId?: number;
  operations: CrudEntry[];
}): boolean {
  const code = errorCode(input.error);
  const tenantId = tenantIdFrom(input.operations);
  const failureKey =
    input.transactionId != null
      ? `tenant:${tenantId}:transaction:${input.transactionId}`
      : `tenant:${tenantId}:operations:${input.operations
          .map((operation) => operation.clientId)
          .join("-")}`;
  if (reportedFailures.has(failureKey)) return false;
  reportedFailures.add(failureKey);

  Sentry.withScope((scope) => {
    scope.setLevel("error");
    scope.setTag("component", "powersync_upload");
    scope.setTag("sync_failure", "permanent");
    scope.setTag("postgres_code", code);
    scope.setFingerprint(["powersync-permanent-upload", code]);
    scope.setContext("sync", {
      transaction_id: input.transactionId ?? null,
      operation_count: input.operations.length,
      tables: [
        ...new Set(input.operations.map((operation) => operation.table)),
      ],
      operation_types: [
        ...new Set(input.operations.map((operation) => operation.op)),
      ],
    });
    const reportError = new Error(
      `Permanent PowerSync upload failure (${code})`
    );
    reportError.name = "PowerSyncPermanentUploadError";
    Sentry.captureException(reportError);
  });

  return true;
}

/**
 * Give the browser transport a short chance to send permanent-sync telemetry
 * before identity cleanup removes caches and disconnects PowerSync. Cleanup
 * must never be blocked by telemetry delivery.
 */
export async function flushPendingSyncFailureTelemetry(): Promise<void> {
  try {
    await Sentry.flush(telemetryFlushTimeoutMs);
  } catch (error) {
    console.warn("[PowerSync] failed to flush permanent upload telemetry", {
      error,
    });
  }
}
