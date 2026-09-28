import "server-only";

import { asc, eq } from "drizzle-orm";
import { toIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { tenantUsers } from "@/lib/db/schema";
import type { TenantMember } from "@/lib/types";

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
