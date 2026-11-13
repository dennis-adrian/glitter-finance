import "server-only";

import { asc, eq } from "drizzle-orm";
import { toIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { formerTenantMembers, tenantUsers } from "@/lib/db/schema";
import type { FormerTenantMember, TenantMember } from "@/lib/types";

export async function getTenantMembersForTenant(
  tenantId: string
): Promise<TenantMember[]> {
  const rows = await db
    .select({
      id: tenantUsers.id,
      userId: tenantUsers.userId,
      displayName: tenantUsers.displayName,
      createdAt: tenantUsers.createdAt,
    })
    .from(tenantUsers)
    .where(eq(tenantUsers.tenantId, tenantId))
    .orderBy(asc(tenantUsers.createdAt), asc(tenantUsers.id));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    createdAt: toIso(row.createdAt),
  }));
}

/** Who left the tenant or was removed from it, for their records' names. */
export async function getFormerTenantMembersForTenant(
  tenantId: string
): Promise<FormerTenantMember[]> {
  const rows = await db
    .select({
      id: formerTenantMembers.id,
      userId: formerTenantMembers.userId,
      displayName: formerTenantMembers.displayName,
      removedAt: formerTenantMembers.removedAt,
    })
    .from(formerTenantMembers)
    .where(eq(formerTenantMembers.tenantId, tenantId))
    .orderBy(asc(formerTenantMembers.removedAt), asc(formerTenantMembers.id));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    removedAt: toIso(row.removedAt),
  }));
}

/**
 * The members and the former members, one query after the other: '/' starts
 * as many reads at once as the pool has connections (lib/db).
 */
export async function getTenantRosterForTenant(tenantId: string) {
  const members = await getTenantMembersForTenant(tenantId);
  const formerMembers = await getFormerTenantMembersForTenant(tenantId);
  return { members, formerMembers };
}
