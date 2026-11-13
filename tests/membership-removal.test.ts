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
stubModule("@/lib/db", {
  db: {
    execute: async (query: { queryChunks?: unknown[] }) => {
      statements.push(JSON.stringify(query.queryChunks ?? query));
      if (nextError) throw nextError;
      return nextRows;
    },
  },
});

test.beforeEach(() => {
  nextError = null;
  nextRows = [];
  statements.length = 0;
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

test("the account's data deletion resolves to the deleted puestos", async () => {
  const { deleteAccountData } = await import("@/lib/auth/membership-removal");
  nextRows = [{ tenant_id: "t1" }, { tenant_id: "t2" }];

  assert.deepEqual(await deleteAccountData("u"), ["t1", "t2"]);
  assert.match(statements[0], /public\.delete_account_data/);
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
