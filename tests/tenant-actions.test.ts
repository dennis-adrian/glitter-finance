// The tenant server actions (app/tenants/actions.ts): the recovery panel's
// way back to the tenant a device's unsynced work was recorded in, removing a
// member and leaving a tenant.

import assert from "node:assert/strict";
import test from "node:test";
import { UserFacingError } from "@/lib/action-result";
import {
  requireExpectedTenant,
  TENANT_ACCESS_REMOVED_MESSAGE,
} from "@/lib/auth/tenant-context";
import { stubModule } from "./support/stub-module";

const TENANT_ID = "70000000-0000-4000-8000-000000000001";
const USER_ID = "71000000-0000-4000-8000-000000000001";
const MEMBER_ID = "72000000-0000-4000-8000-000000000001";
const user = { id: USER_ID, app_metadata: {} };
let signedIn = true;
let member = true;
let removalError: Error | null = null;
let claimMoveFails = false;
const claims: string[] = [];
const removals: {
  actorUserId: string;
  tenantId: string;
  memberUserId: string;
}[] = [];
const claimMoves: [string, string][] = [];

stubModule("@/lib/db", { db: {} });
stubModule("@/lib/auth/memberships", {
  createTenantWithOwner: async () => {
    throw new Error("not used");
  },
  hasMembership: async (
    _client: unknown,
    input: { tenantId: string; userId: string }
  ) => member && input.tenantId === TENANT_ID && input.userId === user.id,
});
stubModule("@/lib/auth/membership-removal", {
  removeMembership: async (input: (typeof removals)[number]) => {
    if (removalError) throw removalError;
    removals.push(input);
  },
});
stubModule("@/lib/auth/user-context", {
  assertUserIsMember: async () => {},
  getAuthenticatedUser: async () => (signedIn ? user : null),
  setActiveTenantClaim: async (_user: unknown, tenantId: string) => {
    claims.push(tenantId);
  },
  moveActiveTenantClaimAway: async (userId: string, tenantId: string) => {
    if (claimMoveFails) throw new Error("Auth is down");
    claimMoves.push([userId, tenantId]);
  },
  // The real tenant check, for a member whose active tenant is TENANT_ID.
  requireExpectedTenantContext: async (
    expectedTenantId: unknown,
    missingTenantMessage: string
  ) =>
    requireExpectedTenant(
      signedIn
        ? {
            user: { id: USER_ID, email: null, displayName: "Ana" },
            tenant: { id: TENANT_ID, name: "Puesto", createdByUserId: null },
            tenants: [{ id: TENANT_ID, name: "Puesto" }],
          }
        : null,
      expectedTenantId,
      missingTenantMessage
    ),
});

test.beforeEach(() => {
  signedIn = true;
  member = true;
  removalError = null;
  claimMoveFails = false;
  claims.length = 0;
  removals.length = 0;
  claimMoves.length = 0;
});

test("returning to a tenant the user still belongs to sets the claim", async () => {
  const { returnToTenant } = await import("@/app/tenants/actions");

  assert.deepEqual(await returnToTenant(TENANT_ID), {
    ok: true,
    data: "switched",
  });
  assert.deepEqual(claims, [TENANT_ID]);
});

test("a lost membership is an answer, and the claim stays", async () => {
  const { returnToTenant } = await import("@/app/tenants/actions");
  member = false;

  assert.deepEqual(await returnToTenant(TENANT_ID), {
    ok: true,
    data: "no-access",
  });
  assert.deepEqual(claims, []);
});

test("returning needs a session", async () => {
  const { returnToTenant } = await import("@/app/tenants/actions");
  signedIn = false;

  assert.deepEqual(await returnToTenant(TENANT_ID), {
    ok: false,
    error: "No iniciaste sesión.",
  });
  assert.deepEqual(claims, []);
});

test("removing a member asks Postgres, then moves the member's claim away", async () => {
  const { removeTenantMember } = await import("@/app/tenants/actions");

  assert.deepEqual(
    await removeTenantMember(TENANT_ID, MEMBER_ID.toUpperCase()),
    { ok: true, data: undefined }
  );
  assert.deepEqual(removals, [
    { actorUserId: USER_ID, tenantId: TENANT_ID, memberUserId: MEMBER_ID },
  ]);
  assert.deepEqual(claimMoves, [[MEMBER_ID, TENANT_ID]]);
});

test("a refused removal returns Postgres' reason and moves no claim", async () => {
  const { removeTenantMember } = await import("@/app/tenants/actions");
  removalError = new UserFacingError(
    "Solo quien creó el puesto puede quitar a otros miembros."
  );

  assert.deepEqual(await removeTenantMember(TENANT_ID, MEMBER_ID), {
    ok: false,
    error: "Solo quien creó el puesto puede quitar a otros miembros.",
  });
  assert.deepEqual(claimMoves, []);
});

test("a removal is done once the membership is gone, even if the claim is not moved", async () => {
  const { removeTenantMember } = await import("@/app/tenants/actions");
  claimMoveFails = true;
  const logged = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await removeTenantMember(TENANT_ID, MEMBER_ID), {
      ok: true,
      data: undefined,
    });
  } finally {
    console.error = logged;
  }
  assert.equal(removals.length, 1);
});

test("removing yourself, or an invalid member, is refused before any database work", async () => {
  const { removeTenantMember } = await import("@/app/tenants/actions");

  assert.deepEqual(await removeTenantMember(TENANT_ID, USER_ID), {
    ok: false,
    error: "Para irte del puesto, usá «Salir del puesto».",
  });
  assert.deepEqual(await removeTenantMember(TENANT_ID, "member-1"), {
    ok: false,
    error: "Miembro inválido.",
  });
  assert.deepEqual(removals, []);
});

test("a screen showing a tenant the user no longer belongs to is told so", async () => {
  const { removeTenantMember, leaveTenant } =
    await import("@/app/tenants/actions");
  const otherTenant = "70000000-0000-4000-8000-000000000009";

  for (const result of [
    await removeTenantMember(otherTenant, MEMBER_ID),
    await leaveTenant(otherTenant),
  ]) {
    assert.deepEqual(result, {
      ok: false,
      error: TENANT_ACCESS_REMOVED_MESSAGE,
    });
  }
  assert.deepEqual(removals, []);
});

test("leaving removes the user's own membership and moves their claim", async () => {
  const { leaveTenant } = await import("@/app/tenants/actions");

  assert.deepEqual(await leaveTenant(TENANT_ID), { ok: true, data: undefined });
  assert.deepEqual(removals, [
    { actorUserId: USER_ID, tenantId: TENANT_ID, memberUserId: USER_ID },
  ]);
  assert.deepEqual(claimMoves, [[USER_ID, TENANT_ID]]);
});

test("removing and leaving need a session", async () => {
  const { removeTenantMember, leaveTenant } =
    await import("@/app/tenants/actions");
  signedIn = false;

  assert.deepEqual(await leaveTenant(TENANT_ID), {
    ok: false,
    error: "No tenés un puesto activo.",
  });
  assert.deepEqual(await removeTenantMember(TENANT_ID, MEMBER_ID), {
    ok: false,
    error: "No tenés un puesto activo.",
  });
  assert.deepEqual(removals, []);
});
