// No `import "server-only"` here: scripts/seed-qa.ts imports ensureMembership
// under plain tsx, where that marker throws (tests/server-only-marker.test.ts).
import { and, asc, eq } from "drizzle-orm";
import type { MembershipRow } from "@/lib/auth/tenant-context";
import { db } from "@/lib/db";
import { tenantUsers, tenants } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export async function loadAllMemberships(
  client: DbOrTx,
  userId: string
): Promise<MembershipRow[]> {
  return client
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantCreatedByUserId: tenants.createdByUserId,
      displayName: tenantUsers.displayName,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, userId))
    .orderBy(asc(tenantUsers.createdAt));
}

export async function hasMembership(
  client: DbOrTx,
  input: { tenantId: string; userId: string }
): Promise<boolean> {
  const [membership] = await client
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, input.tenantId),
        eq(tenantUsers.userId, input.userId)
      )
    )
    .limit(1);
  return Boolean(membership);
}

export async function ensureMembership(
  client: DbOrTx,
  input: {
    tenantId: string;
    userId: string;
    displayName: string;
  }
): Promise<{ created: boolean }> {
  // Single atomic insert: concurrent redemptions can't both pass a pre-check
  // and then collide on tenant_users_tenant_id_user_id_unique. ON CONFLICT DO
  // NOTHING returns no row when the membership already exists.
  const inserted = await client
    .insert(tenantUsers)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      displayName: input.displayName,
    })
    .onConflictDoNothing({
      target: [tenantUsers.tenantId, tenantUsers.userId],
    })
    .returning({ id: tenantUsers.id });

  return { created: inserted.length > 0 };
}

/**
 * Creates a tenant with its creator as the first member. Both the first
 * sign-in bootstrap and the explicit "create tenant" action use it, inside
 * the caller's transaction, so a tenant never exists without its owner.
 */
export async function createTenantWithOwner(
  tx: Tx,
  input: { name: string; userId: string; displayName: string }
): Promise<MembershipRow> {
  const [tenant] = await tx
    .insert(tenants)
    .values({
      name: input.name,
      createdByUserId: input.userId,
    })
    .returning({ id: tenants.id, name: tenants.name });

  if (!tenant) {
    throw new Error("No se pudo crear el puesto.");
  }

  const [membership] = await tx
    .insert(tenantUsers)
    .values({
      tenantId: tenant.id,
      userId: input.userId,
      displayName: input.displayName,
    })
    .returning({ id: tenantUsers.id });

  if (!membership) {
    throw new Error("No se pudo crear el puesto.");
  }

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantCreatedByUserId: input.userId,
    displayName: input.displayName,
  };
}
