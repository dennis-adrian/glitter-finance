import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  readUnsyncedLocalWork,
  type LocalDataIdentity,
  type UnsyncedLocalWork,
} from "@/lib/powersync/local-data-teardown";
import {
  getDiscardedSyncFailures,
  getUnresolvedSyncFailures,
} from "@/lib/powersync/sync-failures";
import { syncErrorText } from "@/lib/powersync/sync-status";

/** Why the device keeps another identity's data instead of clearing it. */
export type IdentityMismatchBlock =
  | {
      /** Another user's writes: only that user can upload them. */
      reason: "other-account";
      accountEmail: string | null;
    }
  | {
      /** This user's writes for another tenant, stuck on a sync failure. */
      reason: "previous-tenant";
      previousTenantId: string | null;
    };

export type IdentityMismatchPlan =
  | { action: "clear" }
  | {
      action: "drain";
      /** The same user's tenant the work was recorded in, when known. */
      previousTenantId: string | null;
    }
  | { action: "block"; block: IdentityMismatchBlock };

/**
 * Decides what to do with a local database that belongs to another identity
 * than the session's. The active tenant is a per-user claim, so a switch on
 * another device (or another user signing in here) can make this device's
 * identity change while its queue still holds sales, voids and refunds.
 * Clearing is only allowed once nothing is left to upload.
 */
export function planIdentityMismatch(input: {
  stored: LocalDataIdentity | null;
  current: LocalDataIdentity;
  unsynced: UnsyncedLocalWork;
}): IdentityMismatchPlan {
  const { stored, current, unsynced } = input;
  if (
    unsynced.pendingUploadCount === 0 &&
    unsynced.unresolvedFailureCount === 0
  ) {
    return { action: "clear" };
  }

  if (stored?.userId === current.userId) {
    // RPCs and RLS authorize uploads by membership, not by the active-tenant
    // claim, so the same user can still upload the previous tenant's queue.
    if (unsynced.unresolvedFailureCount === 0) {
      return { action: "drain", previousTenantId: stored.tenantId };
    }
    // A failed transaction stays at the head of the queue; only that
    // tenant's Diagnostics screen can resolve it.
    return {
      action: "block",
      block: { reason: "previous-tenant", previousTenantId: stored.tenantId },
    };
  }

  // No marker (a device upgraded from before it existed): the server decides
  // who may upload, and a rejected upload is kept as a sync failure, which
  // blocks on the next plan instead of being lost.
  if (!stored && unsynced.unresolvedFailureCount === 0) {
    return { action: "drain", previousTenantId: null };
  }

  return {
    action: "block",
    block: { reason: "other-account", accountEmail: stored?.email ?? null },
  };
}

/**
 * Whether the session's user may discard the blocked work, as the last way
 * out once it can neither be uploaded nor resolved in its own tenant.
 * Another account's work is never discarded here: that account can still
 * sign in and upload it.
 */
export function canDiscardUnsyncedWork(plan: IdentityMismatchPlan): boolean {
  return plan.action === "block" && plan.block.reason !== "other-account";
}

/** How long the queue may go without uploading before the wait is stalled. */
export const UPLOAD_QUEUE_STALL_MS = 30_000;

/** What the provider shows while it waits for the upload queue. */
export type UploadQueueProgress = UnsyncedLocalWork & {
  /** The last upload attempt's error, until an upload goes through. */
  uploadError: string | null;
  /**
   * The wait may be long: the last upload failed or was deferred, or nothing
   * uploaded for `stallAfterMs`. The recovery panel then offers its ways out
   * (offline, a server error, a device clock that was ahead).
   */
  stalled: boolean;
};

export type UploadQueueDrainOutcome = "drained" | "failed" | "cancelled";

/**
 * Waits, on a connected database, until the upload queue is empty or a
 * permanent failure blocks it. Re-checks on every status change and at least
 * every `pollIntervalMs`; transient failures (offline) keep waiting, and are
 * reported through `onProgress` as a stalled wait.
 */
export async function waitForUploadQueueToDrain(
  db: AbstractPowerSyncDatabase,
  options: {
    isCancelled: () => boolean;
    onProgress?: (progress: UploadQueueProgress) => void;
    pollIntervalMs?: number;
    stallAfterMs?: number;
    /** A monotonic clock, in milliseconds. */
    now?: () => number;
  }
): Promise<UploadQueueDrainOutcome> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const stallAfterMs = options.stallAfterMs ?? UPLOAD_QUEUE_STALL_MS;
  const now = options.now ?? (() => performance.now());
  let fewestPending = Number.POSITIVE_INFINITY;
  let lastUploadAt = now();
  for (;;) {
    if (options.isCancelled()) return "cancelled";
    const unsynced = await readUnsyncedLocalWork(db);
    if (options.isCancelled()) return "cancelled";
    if (unsynced.unresolvedFailureCount > 0) return "failed";
    if (unsynced.pendingUploadCount === 0) return "drained";
    if (unsynced.pendingUploadCount < fewestPending) {
      fewestPending = unsynced.pendingUploadCount;
      lastUploadAt = now();
    }
    const uploadError = syncErrorText(
      db.currentStatus?.dataFlowStatus.uploadError
    );
    options.onProgress?.({
      ...unsynced,
      uploadError,
      stalled:
        uploadError !== null ||
        unsynced.uploadHold !== null ||
        now() - lastUploadAt >= stallAfterMs,
    });
    await nextStatusChange(db, pollIntervalMs);
  }
}

function nextStatusChange(db: AbstractPowerSyncDatabase, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let unregister: () => void = () => {};
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      unregister();
      resolve();
    }
    unregister = db.registerListener({ statusChanged: done });
  });
}

/** One operation of PowerSync's upload queue (a ps_crud row). */
export type QueuedOperation = {
  clientId: number;
  transactionId: number | null;
  op: string;
  table: string;
  id: string;
  data: Record<string, unknown> | null;
};

type QueuedOperationRow = { id: number; tx_id: number | null; data: string };

function parseQueuedOperation(row: QueuedOperationRow): QueuedOperation | null {
  let entry: unknown;
  try {
    entry = JSON.parse(row.data);
  } catch {
    return null;
  }
  if (!entry || typeof entry !== "object") return null;
  const { op, type, id, data } = entry as Record<string, unknown>;
  if (
    typeof op !== "string" ||
    typeof type !== "string" ||
    typeof id !== "string"
  ) {
    return null;
  }
  return {
    clientId: Number(row.id),
    transactionId: row.tx_id == null ? null : Number(row.tx_id),
    op,
    table: type,
    id,
    data:
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null,
  };
}

function readQueueRows(db: AbstractPowerSyncDatabase) {
  return db.getAll<QueuedOperationRow>(
    `SELECT id, tx_id, data FROM ps_crud ORDER BY id`
  );
}

/**
 * Everything discarding the device's unsynced work would lose, as JSON the
 * user keeps to record it again: the queued operations in upload order (an
 * unreadable one as its raw row), the failure records with the server's
 * errors, and the operations discarded earlier from Diagnostics.
 */
export async function exportUnsyncedLocalWork(
  db: AbstractPowerSyncDatabase,
  identities: {
    /** Whose work the device holds, when known. */
    owner: LocalDataIdentity | null;
    session: LocalDataIdentity;
  },
  generatedAt = new Date()
): Promise<string> {
  const [rows, failures, discardedFailures] = await Promise.all([
    readQueueRows(db),
    getUnresolvedSyncFailures(db),
    getDiscardedSyncFailures(db),
  ]);
  return JSON.stringify(
    {
      generatedAt: generatedAt.toISOString(),
      owner: identities.owner,
      session: identities.session,
      queue: rows.map(
        (row) =>
          parseQueuedOperation(row) ?? {
            clientId: Number(row.id),
            transactionId: row.tx_id == null ? null : Number(row.tx_id),
            raw: row.data,
          }
      ),
      failures,
      discardedFailures,
    },
    null,
    2
  );
}
