// What PowerSyncProvider shows, and offers, while the device holds unsynced
// work of another identity than the session's (lib/powersync/identity-mismatch.ts).
// Every state has a way out that keeps the work: going back to the tenant it
// was recorded in, or signing out. Discarding it is the last one, offered only
// when the work is stuck and cannot be resolved in its own tenant.

import type {
  IdentityMismatchBlock,
  IdentityMismatchPlan,
  UploadQueueProgress,
} from "@/lib/powersync/identity-mismatch";
import type { UploadHold } from "@/lib/powersync/upload-holds";

export type LocalDataRecovery =
  | {
      kind: "draining";
      pendingUploadCount: number;
      uploadHold: UploadHold | null;
      uploadError: string | null;
      stalled: boolean;
      /** The same user's tenant the work was recorded in, when known. */
      previousTenantId: string | null;
    }
  | {
      kind: "blocked";
      block: IdentityMismatchBlock;
      pendingUploadCount: number;
      /** The last upload attempt's error, while uploads keep being retried. */
      uploadError: string | null;
    };

/** The panel for a plan that is not "clear", as the upload queue stands. */
export function localDataRecoveryFor(
  plan: IdentityMismatchPlan,
  progress: UploadQueueProgress
): LocalDataRecovery {
  if (plan.action === "block") {
    return {
      kind: "blocked",
      block: plan.block,
      pendingUploadCount: progress.pendingUploadCount,
      uploadError: progress.uploadError,
    };
  }
  return {
    kind: "draining",
    pendingUploadCount: progress.pendingUploadCount,
    uploadHold: progress.uploadHold,
    uploadError: progress.uploadError,
    stalled: progress.stalled,
    previousTenantId: plan.action === "drain" ? plan.previousTenantId : null,
  };
}

/**
 * Whether switching back to the work's tenant is still possible. "lost" once
 * the server said the user is no longer a member of it.
 */
export type PreviousTenantAccess = "unknown" | "lost";

export type LocalDataRecoveryActions = {
  /** "Volver al puesto anterior": the tenant to switch back to. */
  switchBackTo: string | null;
  signOut: boolean;
  /** Reconnect, so the rejected upload is sent again right away. */
  retry: boolean;
  /** Download a copy of the work and, once confirmed, discard it. */
  discard: boolean;
};

const noActions: LocalDataRecoveryActions = {
  switchBackTo: null,
  signOut: false,
  retry: false,
  discard: false,
};

export function localDataRecoveryActions(
  recovery: LocalDataRecovery,
  previousTenantAccess: PreviousTenantAccess
): LocalDataRecoveryActions {
  const reachable = (tenantId: string | null) =>
    previousTenantAccess === "lost" ? null : tenantId;

  if (recovery.kind === "draining") {
    // Most drains finish on their own; the ways out only appear once it
    // stops advancing, so a drain about to finish is not abandoned.
    return recovery.stalled
      ? {
          ...noActions,
          switchBackTo: reachable(recovery.previousTenantId),
          signOut: true,
        }
      : noActions;
  }

  const { block } = recovery;
  if (block.reason === "other-account") {
    return { ...noActions, signOut: true };
  }

  const switchBackTo =
    block.reason === "previous-tenant"
      ? reachable(block.previousTenantId)
      : null;
  // In its own tenant, Diagnostics resolves or discards each failure
  // precisely; these are for when no such tenant is within reach. Without
  // access to it, the server rejects the retry too.
  const stuck = switchBackTo === null;
  return {
    switchBackTo,
    signOut: true,
    retry: stuck && previousTenantAccess !== "lost",
    discard: stuck,
  };
}
