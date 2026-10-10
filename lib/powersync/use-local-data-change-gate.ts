"use client";

import { isPowerSyncConfigured } from "@/lib/env";
import { getLocalDataChangeBlocker } from "@/lib/powersync/local-data-gate";
import { useSyncStatus } from "@/lib/powersync/use-sync-status";

/**
 * The one gate for every action that clears the local data. Screens disable
 * those actions and explain `blocker` while it is set; the teardown itself
 * re-checks the queue, so a stale snapshot can only cause a refusal.
 */
export function useLocalDataChangeGate() {
  const { state, pendingCount, failureCount, uploadHold } = useSyncStatus();
  const blocker = getLocalDataChangeBlocker({
    powerSyncConfigured: isPowerSyncConfigured(),
    syncState: state,
    pendingCount,
    failureCount,
  });
  return {
    canChange: blocker === null,
    blocker,
    pendingCount,
    failureCount,
    /** Why pending uploads wait, when the server defers them. */
    uploadHold,
  };
}
