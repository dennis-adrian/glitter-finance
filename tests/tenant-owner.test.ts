// Who may remove whom, what deleting an account does to each puesto, and the
// seller names of former members (lib/auth/tenant-owner.ts,
// lib/powersync/tenant-users-from-local.ts). Postgres enforces the same
// rules: tests/db/membership-removal.test.sql.

import assert from "node:assert/strict";
import test from "node:test";
import {
  isAccountDeletionConfirmed,
  memberActionFor,
  planAccountDeletion,
  resolveTenantOwnerId,
} from "@/lib/auth/tenant-owner";
import { buildUserNameMap } from "@/lib/powersync/tenant-users-from-local";

const members = [{ userId: "first" }, { userId: "creator" }, { userId: "x" }];

test("the creator owns the puesto while they are a member", () => {
  assert.equal(resolveTenantOwnerId("creator", members), "creator");
});

test("without a creator among the members, the longest-standing member owns it", () => {
  assert.equal(resolveTenantOwnerId(null, members), "first");
  assert.equal(resolveTenantOwnerId("gone", members), "first");
  assert.equal(resolveTenantOwnerId(null, []), null);
});

test("only the owner removes others, and everyone else can leave", () => {
  const owner = "creator";
  assert.equal(
    memberActionFor({
      actorUserId: owner,
      ownerUserId: owner,
      memberUserId: "x",
    }),
    "remove"
  );
  assert.equal(
    memberActionFor({
      actorUserId: owner,
      ownerUserId: owner,
      memberUserId: owner,
    }),
    null,
    "the owner cannot leave"
  );
  assert.equal(
    memberActionFor({
      actorUserId: "x",
      ownerUserId: owner,
      memberUserId: "x",
    }),
    "leave"
  );
  assert.equal(
    memberActionFor({
      actorUserId: "x",
      ownerUserId: owner,
      memberUserId: "first",
    }),
    null
  );
  assert.equal(
    memberActionFor({
      actorUserId: "x",
      ownerUserId: owner,
      memberUserId: owner,
    }),
    null
  );
});

test("deleting an account deletes solo puestos, leaves shared ones and is blocked by owned shared ones", () => {
  const plan = planAccountDeletion([
    { id: "a", name: "Solo", otherMemberCount: 0, isOwner: true },
    { id: "b", name: "Ajeno", otherMemberCount: 2, isOwner: false },
    { id: "c", name: "Propio", otherMemberCount: 1, isOwner: true },
  ]);

  assert.deepEqual(plan, {
    deletes: [{ id: "a", name: "Solo" }],
    leaves: [{ id: "b", name: "Ajeno" }],
    blockers: [{ id: "c", name: "Propio" }],
  });
  assert.deepEqual(planAccountDeletion([]), {
    deletes: [],
    leaves: [],
    blockers: [],
  });
});

test("the deletion needs the confirmation word, in any case", () => {
  assert.equal(isAccountDeletionConfirmed("ELIMINAR"), true);
  assert.equal(isAccountDeletionConfirmed(" eliminar "), true);
  for (const value of ["", "ELIMINA", "borrar", undefined, null, 1]) {
    assert.equal(isAccountDeletionConfirmed(value), false);
  }
});

test("a former member's records keep their name, and a member who rejoined goes by the current one", () => {
  const names = buildUserNameMap(
    [{ id: "m1", userId: "u1", displayName: "Ana", createdAt: "" }],
    [
      { id: "f1", userId: "u1", displayName: "Ana vieja", removedAt: "" },
      { id: "f2", userId: "u2", displayName: "Beto", removedAt: "" },
    ]
  );

  assert.equal(names.get("u1"), "Ana");
  assert.equal(names.get("u2"), "Beto");
  assert.equal(names.size, 2);
});
