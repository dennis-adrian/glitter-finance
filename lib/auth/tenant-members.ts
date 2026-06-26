import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantUsers } from "@/lib/db/schema";
import type { TenantMember } from "@/lib/types";

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

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
    .orderBy(asc(tenantUsers.createdAt));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    createdAt: toIso(row.createdAt),
  }));
}
