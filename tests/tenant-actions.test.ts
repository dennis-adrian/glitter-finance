// The recovery panel's way back to the tenant a device's unsynced work was
// recorded in (app/tenants/actions.ts).

import assert from "node:assert/strict";
import test from "node:test";
import { stubModule } from "./support/stub-module";

const TENANT_ID = "70000000-0000-4000-8000-000000000001";
const user = { id: "user-1", app_metadata: {} };
let signedIn = true;
let member = true;
const claims: string[] = [];

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
stubModule("@/lib/auth/user-context", {
  assertUserIsMember: async () => {},
  getAuthenticatedUser: async () => (signedIn ? user : null),
  setActiveTenantClaim: async (_user: unknown, tenantId: string) => {
    claims.push(tenantId);
  },
});

test.beforeEach(() => {
  signedIn = true;
  member = true;
  claims.length = 0;
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
    error: "No has iniciado sesión.",
  });
  assert.deepEqual(claims, []);
});
