import assert from "node:assert/strict";
import test from "node:test";
import type {
  IdentityMismatchBlock,
  UploadQueueProgress,
} from "@/lib/powersync/identity-mismatch";
import {
  localDataRecoveryActions,
  localDataRecoveryFor,
  type LocalDataRecovery,
} from "@/lib/powersync/local-data-recovery";

const progress: UploadQueueProgress = {
  pendingUploadCount: 3,
  unresolvedFailureCount: 0,
  uploadHold: null,
  uploadError: null,
  stalled: false,
};

function blocked(block: IdentityMismatchBlock): LocalDataRecovery {
  return localDataRecoveryFor(
    { action: "block", block },
    { ...progress, unresolvedFailureCount: 1, stalled: true }
  );
}

function draining(
  previousTenantId: string | null,
  overrides: Partial<UploadQueueProgress> = {}
): LocalDataRecovery {
  return localDataRecoveryFor(
    { action: "drain", previousTenantId },
    { ...progress, ...overrides }
  );
}

test("the panel follows the plan as the queue changes", () => {
  assert.deepEqual(draining("tenant-a", { uploadError: "Failed to fetch" }), {
    kind: "draining",
    pendingUploadCount: 3,
    uploadHold: null,
    uploadError: "Failed to fetch",
    stalled: false,
    previousTenantId: "tenant-a",
  });
  assert.deepEqual(blocked({ reason: "unattributed" }), {
    kind: "blocked",
    block: { reason: "unattributed" },
    pendingUploadCount: 3,
    uploadError: null,
  });
});

test("a drain that is advancing offers nothing to interrupt it", () => {
  assert.deepEqual(localDataRecoveryActions(draining("tenant-a"), "unknown"), {
    switchBackTo: null,
    signOut: false,
    retry: false,
    discard: false,
  });
});

test("a stalled drain offers going back to its tenant, or signing out", () => {
  const stalled = draining("tenant-a", { stalled: true });

  assert.deepEqual(localDataRecoveryActions(stalled, "unknown"), {
    switchBackTo: "tenant-a",
    signOut: true,
    retry: false,
    discard: false,
  });
  // Nothing failed yet, so the work is not discarded while it may upload.
  assert.deepEqual(localDataRecoveryActions(stalled, "lost"), {
    switchBackTo: null,
    signOut: true,
    retry: false,
    discard: false,
  });
  assert.deepEqual(
    localDataRecoveryActions(draining(null, { stalled: true }), "unknown"),
    { switchBackTo: null, signOut: true, retry: false, discard: false }
  );
});

test("another account's work can only be left by signing out", () => {
  for (const access of ["unknown", "lost"] as const) {
    assert.deepEqual(
      localDataRecoveryActions(
        blocked({ reason: "other-account", accountEmail: "ana@example.com" }),
        access
      ),
      { switchBackTo: null, signOut: true, retry: false, discard: false }
    );
  }
});

test("a failure in a reachable previous tenant sends the user back there", () => {
  assert.deepEqual(
    localDataRecoveryActions(
      blocked({ reason: "previous-tenant", previousTenantId: "tenant-a" }),
      "unknown"
    ),
    { switchBackTo: "tenant-a", signOut: true, retry: false, discard: false }
  );
});

test("a failure in a tenant the user lost access to can be discarded", () => {
  assert.deepEqual(
    localDataRecoveryActions(
      blocked({ reason: "previous-tenant", previousTenantId: "tenant-a" }),
      "lost"
    ),
    { switchBackTo: null, signOut: true, retry: false, discard: true }
  );
});

test("a failure with no tenant to go back to can be discarded", () => {
  assert.deepEqual(
    localDataRecoveryActions(
      blocked({ reason: "previous-tenant", previousTenantId: null }),
      "unknown"
    ),
    { switchBackTo: null, signOut: true, retry: true, discard: true }
  );
});

test("work nobody can be named for can be retried or discarded", () => {
  assert.deepEqual(
    localDataRecoveryActions(blocked({ reason: "unattributed" }), "unknown"),
    { switchBackTo: null, signOut: true, retry: true, discard: true }
  );
});
