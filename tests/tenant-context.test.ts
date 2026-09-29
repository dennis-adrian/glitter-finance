import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACTIVE_TENANT_CHANGED_MESSAGE,
  getDisplayName,
  parseTenantId,
  requireExpectedTenant,
  resolveUserTenantContextFor,
  type MembershipRow,
} from "@/lib/auth/tenant-context";

const TENANT_A = "0f0e7a52-5c1e-4f0a-9d7e-6a1b2c3d4e5f";
const TENANT_B = "7a000000-0000-4000-8000-000000000001";

function membership(tenantId: string, name: string): MembershipRow {
  return {
    tenantId,
    tenantName: name,
    tenantCreatedByUserId: "owner-1",
    displayName: "Ana",
  };
}

function user(claim?: string) {
  return {
    id: "user-1",
    email: "ana@example.com",
    user_metadata: { display_name: "Ana Pérez" },
    app_metadata: claim ? { tenant_id: claim } : {},
  };
}

test("a user without memberships resolves to no tenant", () => {
  const context = resolveUserTenantContextFor(user(), []);

  assert.equal(context.tenant, null);
  assert.deepEqual(context.tenants, []);
  assert.equal(context.claimedTenantId, null);
  assert.equal(context.user.displayName, "Ana Pérez");
});

test("the claim picks the active tenant among the memberships", () => {
  const context = resolveUserTenantContextFor(user(TENANT_B), [
    membership(TENANT_A, "Puesto A"),
    membership(TENANT_B, "Puesto B"),
  ]);

  assert.equal(context.tenant?.id, TENANT_B);
  assert.equal(context.claimedTenantId, TENANT_B);
  assert.deepEqual(
    context.tenants.map((tenant) => tenant.id),
    [TENANT_A, TENANT_B]
  );
});

test("a missing or stale claim falls back without claiming the fallback", () => {
  const memberships = [membership(TENANT_A, "Puesto A")];

  for (const claim of [undefined, TENANT_B]) {
    const context = resolveUserTenantContextFor(user(claim), memberships);
    assert.equal(context.tenant?.id, TENANT_A);
    // PowerSync would not sync it until '/' writes the claim.
    assert.equal(context.claimedTenantId, null);
  }
});

test("the join page resolves the user without ever bootstrapping a tenant", () => {
  const page = readFileSync("app/join/[token]/page.tsx", "utf8");

  assert.match(page, /resolveUserTenantContext\(\)/);
  assert.doesNotMatch(page, /ensureUserTenantContext/);
});

test("an action runs only for the tenant its screen renders", () => {
  const context = resolveUserTenantContextFor(user(TENANT_A), [
    membership(TENANT_A, "Puesto A"),
    membership(TENANT_B, "Puesto B"),
  ]);

  assert.equal(
    requireExpectedTenant(context, TENANT_A, "Sin cuenta.").tenant.id,
    TENANT_A
  );
  assert.equal(
    requireExpectedTenant(context, ` ${TENANT_A.toUpperCase()} `, "Sin cuenta.")
      .tenant.id,
    TENANT_A
  );
  // A UserFacingError, so the server action returns it instead of throwing.
  assert.throws(() => requireExpectedTenant(context, TENANT_B, "Sin cuenta."), {
    name: "UserFacingError",
    message: ACTIVE_TENANT_CHANGED_MESSAGE,
  });
});

test("an action without an active tenant or a valid tenant id is refused", () => {
  const empty = resolveUserTenantContextFor(user(), []);

  assert.throws(() => requireExpectedTenant(empty, TENANT_A, "Sin cuenta."), {
    name: "UserFacingError",
    message: "Sin cuenta.",
  });
  assert.throws(() => requireExpectedTenant(null, TENANT_A, "Sin cuenta."), {
    name: "UserFacingError",
    message: "Sin cuenta.",
  });
  for (const invalid of [undefined, "", "tenant-1", 42]) {
    assert.throws(() => requireExpectedTenant(empty, invalid, "Sin cuenta."), {
      name: "UserFacingError",
      message: "Identificador de puesto inválido.",
    });
  }
});

test("tenant ids are normalized to the lowercase form Postgres returns", () => {
  assert.equal(parseTenantId(` ${TENANT_A.toUpperCase()}\n`), TENANT_A);
});

test("display names prefer profile metadata over the email", () => {
  assert.equal(getDisplayName(user()), "Ana Pérez");
  assert.equal(getDisplayName({ email: "luis@example.com" }), "luis");
  assert.equal(getDisplayName({}), "Vendedor");
});
