import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryMovements } from "@/lib/db/schema";
import type { InventoryMovement } from "@/lib/inventory";

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapDbInventoryMovement(
  row: typeof inventoryMovements.$inferSelect
): InventoryMovement {
  return {
    id: row.id,
    tenantId: row.tenantId,
    productId: row.productId,
    userId: row.userId,
    delta: row.delta,
    reason: row.reason,
    note: row.note,
    createdAt: toIso(row.createdAt),
    clientCreatedAt: toIso(row.clientCreatedAt),
  };
}

export async function getInventoryMovementsForTenant(
  tenantId: string
): Promise<InventoryMovement[]> {
  const rows = await db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.tenantId, tenantId))
    .orderBy(asc(inventoryMovements.createdAt), asc(inventoryMovements.id));

  return rows.map(mapDbInventoryMovement);
}
