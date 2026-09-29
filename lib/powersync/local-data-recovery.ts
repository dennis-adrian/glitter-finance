// What PowerSyncProvider shows, and offers, while the device holds unsynced
// work of another identity than the session's (lib/powersync/identity-mismatch.ts).
// Every state has a way out that keeps the work: going back to the tenant it
// was recorded in, or signing out. Discarding it is the last one, offered only
// when the work is stuck and cannot be resolved in its own tenant.

import type {
  IdentityMismatchBlock,
  UploadQueueProgress,
} from "@/lib/powersync/identity-mismatch";
import type { UploadHold } from "@/lib/powersync/upload-holds";

export type LocalDataRecovery =
  | {
      kind: "draining";
      pendingUploadCount: number | null;
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
    };

export function drainingRecovery(
  previousTenantId: string | null,
  progress: UploadQueueProgress | null
): LocalDataRecovery {
  return {
    kind: "draining",
    pendingUploadCount: progress?.pendingUploadCount ?? null,
    uploadHold: progress?.uploadHold ?? null,
    uploadError: progress?.uploadError ?? null,
    stalled: progress?.stalled ?? false,
    previousTenantId,
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
  /** Download a copy of the work and, once confirmed, discard it. */
  discard: boolean;
};

const noActions: LocalDataRecoveryActions = {
  switchBackTo: null,
  signOut: false,
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

  const switchBackTo = reachable(block.previousTenantId);
  return {
    switchBackTo,
    signOut: true,
    // In its own tenant, Diagnostics resolves or discards each failure
    // precisely; this is for when that tenant is out of reach.
    discard: switchBackTo === null,
  };
}
