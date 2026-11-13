// Creating an invitation link (getOrCreateActiveInvitation in
// lib/invitations/repository.ts) rechecks the creator's membership once it
// holds the per-tenant lock that removing a member takes too
// (supabase/manual/20261113120000_tenant_membership_removal.sql), so a member
// removed meanwhile gets no link. The race itself needs two Postgres
// sessions; this pins the order of the steps.

import assert from "node:assert/strict";
import test from "node:test";
import { TENANT_ACCESS_REMOVED_MESSAGE } from "@/lib/auth/tenant-context";
import { stubModule } from "./support/stub-module";

const steps: string[] = [];
let member = false;

function query(kind: string, rows: () => unknown[]) {
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: async () => {
      steps.push(kind);
      return rows();
    },
  };
  return builder;
}

const tx = {
  execute: async (statement: { queryChunks?: unknown[] }) => {
    steps.push(
      JSON.stringify(statement.queryChunks ?? "").includes(
        "pg_advisory_xact_lock"
      )
        ? "lock"
        : "execute"
    );
    return [];
  },
  select: (columns?: Record<string, unknown>) =>
    columns && Object.keys(columns).length === 1 && "id" in columns
      ? query("membership", () => (member ? [{ id: "m1" }] : []))
      : query("active-link", () => []),
  insert: () => ({
    values: () => ({
      returning: async () => {
        steps.push("insert");
        throw new Error("stop after the insert");
      },
    }),
  }),
  update: () => {
    throw new Error("not used");
  },
};

stubModule("server-only", {});
stubModule("@/lib/db", {
  db: { transaction: async (run: (t: typeof tx) => unknown) => run(tx) },
});
stubModule("@/lib/invitations/token", {
  hashInvitationToken: (token: string) => `hash:${token}`,
  encryptInvitationDeliveryToken: (token: string) => `enc:${token}`,
  decryptInvitationDeliveryToken: () => null,
});

const input = {
  tenantId: "70000000-0000-4000-8000-000000000001",
  createdByUserId: "71000000-0000-4000-8000-000000000001",
  token: "raw",
  expiresAt: new Date(Date.now() + 60_000),
};

test.beforeEach(() => {
  steps.length = 0;
});

test("a creator removed meanwhile gets no link, old or new", async () => {
  const { getOrCreateActiveInvitation } =
    await import("@/lib/invitations/repository");
  member = false;

  await assert.rejects(getOrCreateActiveInvitation(input), {
    name: "UserFacingError",
    message: TENANT_ACCESS_REMOVED_MESSAGE,
  });
  assert.deepEqual(steps, ["lock", "membership"]);
});

test("the membership is checked under the lock, before any link is read or made", async () => {
  const { getOrCreateActiveInvitation } =
    await import("@/lib/invitations/repository");
  member = true;

  await assert.rejects(getOrCreateActiveInvitation(input), /stop after/);
  assert.deepEqual(steps, ["lock", "membership", "active-link", "insert"]);
});
