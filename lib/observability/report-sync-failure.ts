import * as Sentry from "@sentry/nextjs";
import type { CrudEntry } from "@powersync/web";
import {
  errorCode,
  syncFailureId,
  tenantIdFrom,
  uploadTablesLabel,
} from "@/lib/powersync/crud-metadata";

const reportedFailures = new Set<string>();
let reconciliationErrorReported = false;
const telemetryFlushTimeoutMs = 2_000;

/**
 * Groups permanent failures by SQLSTATE and by what the upload targeted (the
 * RPC name, or the table names), so a failing sale RPC and a failing product
 * update with the same code stay separate Sentry issues.
 */
export function permanentSyncFailureFingerprint(input: {
  error: unknown;
  operations: CrudEntry[];
  target?: string;
}): [string, string, string] {
  return [
    "powersync-permanent-upload",
    errorCode(input.error) ?? "unknown",
    // Upload target when the caller has no plan: the table names.
    input.target ?? uploadTablesLabel(input.operations),
  ];
}

export function resetReportedSyncFailures() {
  reportedFailures.clear();
  reconciliationErrorReported = false;
}

/** Report reconciliation failures without sending local CRUD payloads or SQL. */
export function reportSyncFailureReconciliationError(): boolean {
  if (reconciliationErrorReported) return false;
  reconciliationErrorReported = true;

  Sentry.withScope((scope) => {
    scope.setLevel("error");
    scope.setTag("component", "powersync_sync_failure_reconciliation");
    scope.setFingerprint(["powersync-sync-failure-reconciliation"]);
    const reportError = new Error(
      "PowerSync sync-failure reconciliation failed"
    );
    reportError.name = "PowerSyncSyncFailureReconciliationError";
    Sentry.captureException(reportError);
  });

  return true;
}

/** Report metadata only. Financial row data and tenant/user identifiers stay local. */
export function reportPermanentSyncFailure(input: {
  error: unknown;
  transactionId?: number;
  operations: CrudEntry[];
  /** RPC name or table name(s) the upload was sent to. */
  target?: string;
}): boolean {
  const fingerprint = permanentSyncFailureFingerprint(input);
  const [, code, target] = fingerprint;
  const failureKey = `tenant:${
    tenantIdFrom(input.operations) ?? "unknown"
  }:${syncFailureId(input)}`;
  if (reportedFailures.has(failureKey)) return false;
  reportedFailures.add(failureKey);

  Sentry.withScope((scope) => {
    scope.setLevel("error");
    scope.setTag("component", "powersync_upload");
    scope.setTag("sync_failure", "permanent");
    scope.setTag("postgres_code", code);
    scope.setTag("upload_target", target);
    scope.setFingerprint(fingerprint);
    scope.setContext("sync", {
      transaction_id: input.transactionId ?? null,
      upload_target: target,
      operation_count: input.operations.length,
      tables: [
        ...new Set(input.operations.map((operation) => operation.table)),
      ],
      operation_types: [
        ...new Set(input.operations.map((operation) => operation.op)),
      ],
    });
    const reportError = new Error(
      `Permanent PowerSync upload failure (${code} on ${target})`
    );
    reportError.name = "PowerSyncPermanentUploadError";
    Sentry.captureException(reportError);
  });

  return true;
}

/**
 * A transaction the server defers because one of its device timestamps is
 * more than 5 minutes ahead of the server clock (55000). It is retried and
 * uploads by itself, but it holds every later upload from the device for as
 * long as the clock was ahead, so the uploader reports it once it has waited
 * a while, at most once per transaction. Like the failure report, only
 * metadata leaves the device.
 */
export function reportUploadHeldByDeviceClock(input: {
  transactionId?: number;
  operations: CrudEntry[];
  /** RPC name or table name(s) the upload was sent to. */
  target?: string;
  /** When the server clock accepts the transaction's timestamps. */
  heldUntil: string | null;
}): boolean {
  const target = input.target ?? uploadTablesLabel(input.operations);
  const holdKey = `hold:tenant:${
    tenantIdFrom(input.operations) ?? "unknown"
  }:${syncFailureId(input)}`;
  if (reportedFailures.has(holdKey)) return false;
  reportedFailures.add(holdKey);

  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    scope.setTag("component", "powersync_upload");
    scope.setTag("sync_failure", "held");
    scope.setTag("postgres_code", "55000");
    scope.setTag("upload_target", target);
    scope.setFingerprint(["powersync-held-upload", "55000", target]);
    scope.setContext("sync", {
      transaction_id: input.transactionId ?? null,
      upload_target: target,
      operation_count: input.operations.length,
      tables: [
        ...new Set(input.operations.map((operation) => operation.table)),
      ],
      operation_types: [
        ...new Set(input.operations.map((operation) => operation.op)),
      ],
      // Compared with the time Sentry received the event, this shows how far
      // ahead the device clock was.
      held_until: input.heldUntil,
    });
    Sentry.captureMessage(
      `PowerSync upload held by the device clock (55000 on ${target})`,
      "warning"
    );
  });

  return true;
}

/**
 * A permanently failed transaction that the user discarded from Diagnostics.
 * Like the failure report, only metadata: the payload stays on the device.
 */
export function reportDiscardedSyncFailure(input: {
  errorCode: string | null;
  operations: { table: string; op: string }[];
  /** False when the transaction had already left the upload queue. */
  removedFromQueue: boolean;
}): void {
  const code = input.errorCode ?? "unknown";
  const target = uploadTablesLabel(input.operations);

  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    scope.setTag("component", "powersync_upload");
    scope.setTag("sync_failure", "discarded");
    scope.setTag("postgres_code", code);
    scope.setTag("upload_target", target);
    scope.setFingerprint(["powersync-discarded-upload", code, target]);
    scope.setContext("sync", {
      upload_target: target,
      operation_count: input.operations.length,
      operation_types: [
        ...new Set(input.operations.map((operation) => operation.op)),
      ],
      removed_from_queue: input.removedFromQueue,
    });
    Sentry.captureMessage(
      `PowerSync upload discarded on the device (${code} on ${target})`,
      "warning"
    );
  });
}

/**
 * The whole unsynced queue, discarded from the local data recovery panel
 * because it could neither be uploaded nor resolved in its own tenant (a
 * tenant the user lost access to, or work nobody can be named for). Only
 * the counts leave the device; the user downloads the payload first.
 */
export function reportDiscardedUnsyncedWork(input: {
  /** The recovery panel's block reason. */
  reason: string;
  pendingUploadCount: number;
  unresolvedFailureCount: number;
}): void {
  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    scope.setTag("component", "powersync_upload");
    scope.setTag("sync_failure", "discarded-queue");
    scope.setTag("recovery_reason", input.reason);
    scope.setFingerprint(["powersync-discarded-unsynced-work", input.reason]);
    scope.setContext("sync", {
      pending_upload_count: input.pendingUploadCount,
      unresolved_failure_count: input.unresolvedFailureCount,
    });
    Sentry.captureMessage(
      `PowerSync unsynced work discarded on the device (${input.reason})`,
      "warning"
    );
  });
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
