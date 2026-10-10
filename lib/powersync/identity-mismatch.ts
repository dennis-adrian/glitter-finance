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
      /**
       * This user's writes stuck on a sync failure, with the tenant they were
       * recorded in when it is another one than the session's.
       */
      reason: "previous-tenant";
      previousTenantId: string | null;
    }
  | {
      /**
       * Writes that name no user, from a device without an identity marker,
       * stuck on a sync failure.
       */
      reason: "unattributed";
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
  /**
   * Whose work the device holds: its identity marker, or without one the
   * owner its queue names (readUnsyncedWorkOwner).
   */
  owner: LocalDataIdentity | null;
  current: LocalDataIdentity;
  unsynced: UnsyncedLocalWork;
}): IdentityMismatchPlan {
  const { owner, current, unsynced } = input;
  if (
    unsynced.pendingUploadCount === 0 &&
    unsynced.unresolvedFailureCount === 0
  ) {
    return { action: "clear" };
  }

  if (!owner) {
    // Nobody can be named for the work: the server decides who may upload
    // it, and a rejected upload is kept as a sync failure.
    return unsynced.unresolvedFailureCount === 0
      ? { action: "drain", previousTenantId: null }
      : { action: "block", block: { reason: "unattributed" } };
  }

  if (owner.userId !== current.userId) {
    // The financial RPCs and RLS only accept a user's writes from that user.
    return {
      action: "block",
      block: { reason: "other-account", accountEmail: owner.email ?? null },
    };
  }

  // RPCs and RLS authorize uploads by membership, not by the active-tenant
  // claim, so the same user can still upload the previous tenant's queue.
  // Without a marker, the queue can name the session's own tenant, which is
  // no tenant to go back to.
  const previousTenantId =
    owner.tenantId !== current.tenantId ? owner.tenantId : null;
  if (unsynced.unresolvedFailureCount === 0) {
    return { action: "drain", previousTenantId };
  }
  // A failed transaction stays at the head of the queue; that tenant's
  // Diagnostics screen can resolve it.
  return {
    action: "block",
    block: { reason: "previous-tenant", previousTenantId },
  };
}

/**
 * Whether the session may upload the work: its own, or work nobody can be
 * named for, which the server accepts or rejects. Such a plan keeps the
 * database connected even while blocked, so an upload rejected for a cause
 * fixed meanwhile on the server (SQL applied late) goes through on a retry.
 */
export function canUploadUnsyncedWork(plan: IdentityMismatchPlan): boolean {
  return (
    plan.action === "drain" ||
    (plan.action === "block" && plan.block.reason !== "other-account")
  );
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

export type UploadQueueDrainOutcome = "drained" | "cancelled";

/**
 * Waits, on a connected database, until the upload queue is empty and no sync
 * failure is left. Re-checks on every status change and at least every
 * `pollIntervalMs`. A failure, or a transient error (offline), keeps it
 * waiting, since PowerSync retries the upload while connected; it is reported
 * through `onProgress` as a stalled wait.
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
    if (
      unsynced.pendingUploadCount === 0 &&
      unsynced.unresolvedFailureCount === 0
    ) {
      return "drained";
    }
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
        unsynced.unresolvedFailureCount > 0 ||
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

// The columns that name the user who recorded a queued write: the seller of a
// sale or refund, whoever voided a sale, whoever counted stock. The financial
// RPCs and the inventory_movements RLS policy accept them only from that user.
const OWNER_COLUMNS: Record<string, readonly string[]> = {
  sales: ["user_id", "voided_by_user_id"],
  refunds: ["user_id"],
  inventory_movements: ["user_id"],
};

/**
 * Whose work a queue holds, for a device without an identity marker: the one
 * user its writes name, with the one tenant they name (null when they name
 * none or several). Null when the writes name no user (product edits only)
 * or several.
 */
export function unsyncedWorkOwner(
  operations: readonly Pick<QueuedOperation, "table" | "data">[]
): LocalDataIdentity | null {
  const userIds = new Set<string>();
  const tenantIds = new Set<string>();
  for (const { table, data } of operations) {
    for (const column of OWNER_COLUMNS[table] ?? []) {
      const userId = data?.[column];
      if (typeof userId === "string" && userId) userIds.add(userId);
    }
    const tenantId = data?.tenant_id;
    if (typeof tenantId === "string" && tenantId) tenantIds.add(tenantId);
  }
  if (userIds.size !== 1) return null;
  return {
    userId: [...userIds][0],
    tenantId: tenantIds.size === 1 ? [...tenantIds][0] : null,
    email: null,
  };
}

/** The owner the upload queue names (unsyncedWorkOwner). */
export async function readUnsyncedWorkOwner(
  db: AbstractPowerSyncDatabase
): Promise<LocalDataIdentity | null> {
  const rows = await readQueueRows(db);
  return unsyncedWorkOwner(
    rows.flatMap((row) => parseQueuedOperation(row) ?? [])
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
