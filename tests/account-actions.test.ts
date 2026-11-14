// Deleting an account (app/account/actions.ts): the order of its steps and
// what each failure leaves behind.

import assert from "node:assert/strict";
import test from "node:test";
import { UserFacingError } from "@/lib/action-result";
import { stubModule } from "./support/stub-module";

const USER_ID = "71000000-0000-4000-8000-000000000001";
const events: string[] = [];
let signedIn = true;
let dataError: Error | null = null;
let storageFails = false;
let signOutError: { code?: string; status?: number } | null = null;
let deleteError: { code?: string; status?: number } | null = null;

stubModule("@/lib/auth/membership-removal", {
  // Commits on its own, with the deleted_accounts marker.
  deleteAccountData: async (userId: string) => {
    if (dataError) throw dataError;
    events.push(`data:${userId}`);
    return ["t1"];
  },
  // The real helper's contract: the soft delete, recorded only on success.
  finishAccountAuthDeletion: async (
    admin: {
      auth: {
        admin: {
          deleteUser: (
            id: string,
            soft: boolean
          ) => Promise<{ error: unknown }>;
        };
      };
    },
    userId: string
  ) => {
    const { error } = await admin.auth.admin.deleteUser(userId, true);
    if (!error) events.push("auth-done");
    return !error;
  },
  finishPendingAuthDeletions: async () => {
    events.push("retry-older");
  },
  loadAccountDeletionPlan: async (userId: string) => {
    events.push(`plan:${userId}`);
    return { deletes: [], leaves: [], blockers: [] };
  },
  storageCleanupQueue: { name: "queue" },
});
stubModule("@/lib/auth/user-context", {
  getAuthenticatedUser: async () => (signedIn ? { id: USER_ID } : null),
});
stubModule("@/lib/tenant-storage-cleanup", {
  drainTenantStorageCleanups: async (
    _client: unknown,
    queue: { name: string },
    first: string[]
  ) => {
    if (storageFails) throw new Error("The queue is unreachable");
    events.push(`storage:${queue.name}:${first.join(",")}`);
    return { completed: first, failed: [] };
  },
});
stubModule("@/lib/supabase/admin", {
  createAdminClient: () => ({
    auth: {
      admin: {
        deleteUser: async (id: string, soft: boolean) => {
          events.push(`delete-user:${id}:${soft ? "soft" : "hard"}`);
          return { data: null, error: deleteError };
        },
      },
    },
  }),
});
stubModule("@/lib/supabase/server", {
  createClient: async () => ({
    auth: {
      signOut: async ({ scope }: { scope: string }) => {
        events.push(`sign-out:${scope}`);
        return { error: signOutError };
      },
    },
  }),
});

test.beforeEach(() => {
  events.length = 0;
  signedIn = true;
  dataError = null;
  storageFails = false;
  signOutError = null;
  deleteError = null;
});

function quietly<T>(run: () => Promise<T>) {
  const logged = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = logged;
  });
}

test("deletes the data, then revokes every session and the auth user, then cleans up", async () => {
  const { deleteAccount } = await import("@/app/account/actions");

  assert.deepEqual(await deleteAccount("eliminar"), {
    ok: true,
    data: undefined,
  });
  assert.deepEqual(events, [
    `data:${USER_ID}`,
    "sign-out:global",
    `delete-user:${USER_ID}:soft`,
    "auth-done",
    "retry-older",
    "storage:queue:t1",
  ]);
});

test("nothing happens without the confirmation word or a session", async () => {
  const { deleteAccount } = await import("@/app/account/actions");

  assert.deepEqual(await deleteAccount("borrar"), {
    ok: false,
    error: "Escribí ELIMINAR para confirmar.",
  });
  signedIn = false;
  assert.deepEqual(await deleteAccount("ELIMINAR"), {
    ok: false,
    error: "No iniciaste sesión.",
  });
  assert.deepEqual(events, []);
});

test("a refused data deletion stops before anything else", async () => {
  const { deleteAccount } = await import("@/app/account/actions");
  dataError = new UserFacingError(
    "Creaste un puesto que tiene otros miembros."
  );

  assert.deepEqual(await deleteAccount("ELIMINAR"), {
    ok: false,
    error: "Creaste un puesto que tiene otros miembros.",
  });
  assert.deepEqual(events, []);
});

test("photos that could not be removed do not stop the deletion", async () => {
  const { deleteAccount } = await import("@/app/account/actions");
  storageFails = true;

  const result = await quietly(() => deleteAccount("ELIMINAR"));

  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    `data:${USER_ID}`,
    "sign-out:global",
    `delete-user:${USER_ID}:soft`,
    "auth-done",
    "retry-older",
  ]);
});

test("a failed session revocation still soft-deletes the auth user", async () => {
  const { deleteAccount } = await import("@/app/account/actions");
  signOutError = { code: "unexpected_failure", status: 500 };

  const result = await quietly(() => deleteAccount("ELIMINAR"));

  // The data and the marker are committed: the account is deleted for the
  // app whatever Auth does.
  assert.equal(result.ok, true);
  assert.ok(events.includes(`delete-user:${USER_ID}:soft`));
});

test("a failed soft delete is left pending for a retry, and the deletion stands", async () => {
  const { deleteAccount } = await import("@/app/account/actions");
  deleteError = { code: "unexpected_failure", status: 500 };

  const result = await quietly(() => deleteAccount("ELIMINAR"));

  assert.equal(result.ok, true);
  assert.ok(!events.includes("auth-done"), "not recorded as finished");
  assert.ok(events.includes("storage:queue:t1"));
});

test("the plan is read for the signed-in user", async () => {
  const { getAccountDeletionPlan } = await import("@/app/account/actions");

  assert.deepEqual(await getAccountDeletionPlan(), {
    ok: true,
    data: { deletes: [], leaves: [], blockers: [] },
  });
  assert.deepEqual(events, [`plan:${USER_ID}`]);
});
