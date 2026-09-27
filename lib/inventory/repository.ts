import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { inventoryMovements, products } from "@/lib/db/schema";
import {
  normalizeInventoryMovement,
  type InventoryMovement,
} from "@/lib/inventory";

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

export type AddInventoryMovementForTenantInput = {
  tenantId: string;
  userId: string;
  productId: string;
  delta: number;
  reason: InventoryMovement["reason"];
  note?: string | null;
};

/**
 * Records a stock movement for one of the tenant's products: the server-action
 * counterpart of the PowerSync writer (lib/powersync/write-inventory.ts), with
 * the same checks. Throws UserFacingError for a movement or product the user
 * can fix.
 */
export async function addInventoryMovementForTenant(
  input: AddInventoryMovementForTenantInput
): Promise<InventoryMovement> {
  const movement = normalizeInventoryMovement(input);

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, input.tenantId),
        eq(products.id, input.productId)
      )
    )
    .limit(1);
  if (!product) {
    throw new UserFacingError("No se encontró el producto.");
  }

  const now = new Date();
  const [row] = await db
    .insert(inventoryMovements)
    .values({
      tenantId: input.tenantId,
      productId: product.id,
      userId: input.userId,
      ...movement,
      createdAt: now,
      clientCreatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("No se pudo registrar el movimiento de inventario.");
  }

  return mapDbInventoryMovement(row);
}
