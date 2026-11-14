// The trusted side of removing members and deleting an account
// (lib/auth/membership-removal.ts): Postgres decides, and its refusals become
// messages the screens can show. The SQL itself is tested in
// tests/db/membership-removal.test.sql.

import assert from "node:assert/strict";
import test from "node:test";
import { stubModule } from "./support/stub-module";

let nextError: unknown = null;
let nextRows: unknown[] = [];
const statements: string[] = [];

function pgError(code: string) {
  // Drizzle wraps the driver's error; the SQLSTATE is on `cause`.
  return Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("raised"), { code }),
  });
}

stubModule("server-only", {});
const transactions: string[] = [];
type FakeDb = {
  execute: (query: { queryChunks?: unknown[] }) => Promise<unknown[]>;
  transaction: <T>(run: (tx: FakeDb) => Promise<T>) => Promise<T>;
};
const fakeDb: FakeDb = {
  execute: async (query: { queryChunks?: unknown[] }) => {
    statements.push(JSON.stringify(query.queryChunks ?? query));
    if (nextError) throw nextError;
    return nextRows;
  },
  // Commits when `run` resolves, rolls back when it throws.
  transaction: async (run) => {
    transactions.push("begin");
    try {
      const result = await run(fakeDb);
      transactions.push("commit");
      return result;
    } catch (error) {
      transactions.push("rollback");
      throw error;
    }
  },
};
stubModule("@/lib/db", { db: fakeDb });

test.beforeEach(() => {
  nextError = null;
  nextRows = [];
  statements.length = 0;
  transactions.length = 0;
});

test("each refusal of remove_tenant_member becomes its own message", async () => {
  const { removeMembership, MEMBERSHIP_REMOVAL_MESSAGES } =
    await import("@/lib/auth/membership-removal");
  const input = { actorUserId: "a", tenantId: "t", memberUserId: "m" };

  for (const [code, message] of Object.entries(MEMBERSHIP_REMOVAL_MESSAGES)) {
    nextError = pgError(code);
    await assert.rejects(removeMembership(input), {
      name: "UserFacingError",
      message,
    });
  }
});

test("any other database error is thrown as is", async () => {
  const { removeMembership } = await import("@/lib/auth/membership-removal");
  const outage = pgError("57P01");
  nextError = outage;

  await assert.rejects(
    removeMembership({ actorUserId: "a", tenantId: "t", memberUserId: "m" }),
    (error) => error === outage
  );
});

test("a removal runs remove_tenant_member", async () => {
  const { removeMembership } = await import("@/lib/auth/membership-removal");

  await removeMembership({
    actorUserId: "a",
    tenantId: "t",
    memberUserId: "m",
  });

  assert.equal(statements.length, 1);
  assert.match(statements[0], /public\.remove_tenant_member/);
});

test("the account's data deletion is one statement, outside any open transaction", async () => {
  const { deleteAccountData } = await import("@/lib/auth/membership-removal");
  nextRows = [{ tenant_id: "t1" }, { tenant_id: "t2" }];

  assert.deepEqual(await deleteAccountData("u"), ["t1", "t2"]);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /public\.delete_account_data/);
  // No transaction is held open while the Auth steps run afterwards.
  assert.deepEqual(transactions, []);
});

test("an owner of a shared puesto is told to remove its members first", async () => {
  const { deleteAccountData, ACCOUNT_DELETION_BLOCKED_MESSAGE } =
    await import("@/lib/auth/membership-removal");
  nextError = pgError("BF409");

  await assert.rejects(deleteAccountData("u"), {
    name: "UserFacingError",
    message: ACCOUNT_DELETION_BLOCKED_MESSAGE,
  });
});

function fakeAdmin(error: { code?: string; status?: number } | null) {
  const calls: [string, boolean | undefined][] = [];
  return {
    calls,
    admin: {
      auth: {
        admin: {
          deleteUser: async (id: string, soft?: boolean) => {
            calls.push([id, soft]);
            return { error };
          },
        },
      },
    },
  };
}

test("the Auth side is recorded as finished only once the soft delete went through", async () => {
  const { finishAccountAuthDeletion } =
    await import("@/lib/auth/membership-removal");

  const ok = fakeAdmin(null);
  assert.equal(await finishAccountAuthDeletion(ok.admin, "u"), true);
  assert.deepEqual(ok.calls, [["u", true]]);
  assert.match(statements.at(-1) ?? "", /auth_deleted_at = now\(\)/);

  statements.length = 0;
  const logged = console.error;
  console.error = () => {};
  try {
    const down = fakeAdmin({ code: "unexpected_failure", status: 500 });
    assert.equal(await finishAccountAuthDeletion(down.admin, "u"), false);
  } finally {
    console.error = logged;
  }
  assert.deepEqual(statements, [], "a failure stays pending for a retry");

  // An auth user that is already gone counts as done.
  const gone = fakeAdmin({ code: "user_not_found", status: 404 });
  assert.equal(await finishAccountAuthDeletion(gone.admin, "u"), true);
});

test("older unfinished Auth deletions are retried, oldest first", async () => {
  const { finishPendingAuthDeletions } =
    await import("@/lib/auth/membership-removal");
  nextRows = [{ user_id: "old-1" }, { user_id: "old-2" }];
  const auth = fakeAdmin(null);

  await finishPendingAuthDeletions(auth.admin, 5);

  assert.match(statements[0], /auth_deleted_at IS NULL/);
  assert.match(statements[0], /ORDER BY deleted_at/);
  assert.deepEqual(
    auth.calls.map(([id]) => id),
    ["old-1", "old-2"]
  );
});

test("a deleted account is recognized by its marker", async () => {
  const { isAccountDeleted } = await import("@/lib/auth/membership-removal");
  nextRows = [{ deleted: true }];
  assert.equal(await isAccountDeleted("u"), true);
  nextRows = [{ deleted: false }];
  assert.equal(await isAccountDeleted("u"), false);
  assert.match(statements[0], /public\.deleted_accounts/);
});

test("the deletion plan sorts the puestos by what happens to them", async () => {
  const { loadAccountDeletionPlan } =
    await import("@/lib/auth/membership-removal");
  nextRows = [
    { id: "a", name: "Solo", other_member_count: 0, is_owner: true },
    { id: "b", name: "Ajeno", other_member_count: "3", is_owner: false },
    { id: "c", name: "Propio", other_member_count: 1, is_owner: true },
  ];

  assert.deepEqual(await loadAccountDeletionPlan("u"), {
    deletes: [{ id: "a", name: "Solo" }],
    leaves: [{ id: "b", name: "Ajeno" }],
    blockers: [{ id: "c", name: "Propio" }],
  });
});
