import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  readUnsyncedLocalWork,
  type LocalDataIdentity,
  type UnsyncedLocalWork,
} from "@/lib/powersync/local-data-teardown";

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
  | { action: "drain" }
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
      return { action: "drain" };
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
    return { action: "drain" };
  }

  return {
    action: "block",
    block: { reason: "other-account", accountEmail: stored?.email ?? null },
  };
}

export type UploadQueueDrainOutcome = "drained" | "failed" | "cancelled";

/**
 * Waits, on a connected database, until the upload queue is empty or a
 * permanent failure blocks it. Re-checks on every status change and at least
 * every `pollIntervalMs`; transient failures (offline) simply keep waiting.
 */
export async function waitForUploadQueueToDrain(
  db: AbstractPowerSyncDatabase,
  options: {
    isCancelled: () => boolean;
    onPending?: (pendingUploadCount: number) => void;
    pollIntervalMs?: number;
  }
): Promise<UploadQueueDrainOutcome> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  for (;;) {
    if (options.isCancelled()) return "cancelled";
    const unsynced = await readUnsyncedLocalWork(db);
    if (options.isCancelled()) return "cancelled";
    if (unsynced.unresolvedFailureCount > 0) return "failed";
    if (unsynced.pendingUploadCount === 0) return "drained";
    options.onPending?.(unsynced.pendingUploadCount);
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
