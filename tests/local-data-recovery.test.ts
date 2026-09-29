import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityMismatchBlock } from "@/lib/powersync/identity-mismatch";
import {
  drainingRecovery,
  localDataRecoveryActions,
  type LocalDataRecovery,
} from "@/lib/powersync/local-data-recovery";

const progress = {
  pendingUploadCount: 3,
  unresolvedFailureCount: 0,
  uploadHold: null,
  uploadError: null,
  stalled: false,
};

function blocked(block: IdentityMismatchBlock): LocalDataRecovery {
  return { kind: "blocked", block, pendingUploadCount: 2 };
}

test("a drain that is advancing offers nothing to interrupt it", () => {
  assert.deepEqual(
    localDataRecoveryActions(drainingRecovery("tenant-a", progress), "unknown"),
    { switchBackTo: null, signOut: false, discard: false }
  );
});

test("a stalled drain offers going back to its tenant, or signing out", () => {
  const stalled = drainingRecovery("tenant-a", { ...progress, stalled: true });

  assert.deepEqual(localDataRecoveryActions(stalled, "unknown"), {
    switchBackTo: "tenant-a",
    signOut: true,
    discard: false,
  });
  // Nothing failed yet, so the work is not discarded while it may upload.
  assert.deepEqual(localDataRecoveryActions(stalled, "lost"), {
    switchBackTo: null,
    signOut: true,
    discard: false,
  });
  assert.deepEqual(
    localDataRecoveryActions(
      drainingRecovery(null, { ...progress, stalled: true }),
      "unknown"
    ),
    { switchBackTo: null, signOut: true, discard: false }
  );
});

test("another account's work can only be left by signing out", () => {
  for (const access of ["unknown", "lost"] as const) {
    assert.deepEqual(
      localDataRecoveryActions(
        blocked({ reason: "other-account", accountEmail: "ana@example.com" }),
        access
      ),
      { switchBackTo: null, signOut: true, discard: false }
    );
  }
});

test("a failure in a reachable previous tenant sends the user back there", () => {
  assert.deepEqual(
    localDataRecoveryActions(
      blocked({ reason: "previous-tenant", previousTenantId: "tenant-a" }),
      "unknown"
    ),
    { switchBackTo: "tenant-a", signOut: true, discard: false }
  );
});

test("a failure in a tenant the user lost access to can be discarded", () => {
  assert.deepEqual(
    localDataRecoveryActions(
      blocked({ reason: "previous-tenant", previousTenantId: "tenant-a" }),
      "lost"
    ),
    { switchBackTo: null, signOut: true, discard: true }
  );
});

test("a failure with no tenant to go back to can be discarded", () => {
  assert.deepEqual(
    localDataRecoveryActions(
      blocked({ reason: "previous-tenant", previousTenantId: null }),
      "unknown"
    ),
    { switchBackTo: null, signOut: true, discard: true }
  );
});
