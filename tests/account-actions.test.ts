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
  // One transaction: the data deletion, then `finishInAuth`, then the commit
  // (or a rollback when it throws).
  deleteAccountData: async (
    userId: string,
    finishInAuth: () => Promise<void>
  ) => {
    if (dataError) throw dataError;
    events.push(`data:${userId}`);
    try {
      await finishInAuth();
    } catch (error) {
      events.push("rollback");
      throw error;
    }
    events.push("commit");
    return ["t1"];
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

test("deletes the data, revokes every session and the auth user, commits, then removes the photos", async () => {
  const { deleteAccount } = await import("@/app/account/actions");

  assert.deepEqual(await deleteAccount("eliminar"), {
    ok: true,
    data: undefined,
  });
  assert.deepEqual(events, [
    `data:${USER_ID}`,
    "sign-out:global",
    `delete-user:${USER_ID}:soft`,
    "commit",
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
    "commit",
  ]);
});

test("the auth user and the data are kept while the sessions could not be revoked", async () => {
  const { deleteAccount } = await import("@/app/account/actions");
  signOutError = { code: "unexpected_failure", status: 500 };

  const result = await quietly(() => deleteAccount("ELIMINAR"));

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /no se borró nada/);
  assert.deepEqual(events, [`data:${USER_ID}`, "sign-out:global", "rollback"]);
});

test("a failed auth user deletion keeps the data and says to try again", async () => {
  const { deleteAccount } = await import("@/app/account/actions");
  deleteError = { code: "unexpected_failure", status: 500 };

  const result = await quietly(() => deleteAccount("ELIMINAR"));

  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /no se borró nada/);
  // The data deletion is rolled back and no photo is touched.
  assert.deepEqual(events, [
    `data:${USER_ID}`,
    "sign-out:global",
    `delete-user:${USER_ID}:soft`,
    "rollback",
  ]);
});

test("the plan is read for the signed-in user", async () => {
  const { getAccountDeletionPlan } = await import("@/app/account/actions");

  assert.deepEqual(await getAccountDeletionPlan(), {
    ok: true,
    data: { deletes: [], leaves: [], blockers: [] },
  });
  assert.deepEqual(events, [`plan:${USER_ID}`]);
});
