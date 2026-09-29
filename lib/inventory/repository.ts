import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { postgresErrorCode } from "@/lib/db/errors";
import { inventoryMovements, products } from "@/lib/db/schema";
import {
  validateInventoryMovement,
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

/**
 * Server-side movement write for local-only mode (no PowerSync). Mirrors
 * addInventoryMovement in lib/powersync/write-inventory.ts.
 */
export async function createInventoryMovementForTenant(input: {
  tenantId: string;
  userId: string;
  productId: string;
  delta: number;
  reason: string;
  note?: string;
}): Promise<InventoryMovement> {
  const { reason } = input;
  validateInventoryMovement(input.delta, reason);

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
    throw new Error("No se encontró el producto.");
  }

  try {
    const [movement] = await db
      .insert(inventoryMovements)
      .values({
        tenantId: input.tenantId,
        productId: input.productId,
        userId: input.userId,
        delta: input.delta,
        reason,
        note: input.note?.trim() || null,
        clientCreatedAt: new Date(),
      })
      .returning();

    if (!movement) {
      throw new Error("No se pudo registrar el movimiento de inventario.");
    }

    return mapDbInventoryMovement(movement);
  } catch (error) {
    if (reason === "initial" && postgresErrorCode(error) === "23505") {
      throw new Error("Este producto ya tiene un stock inicial registrado.");
    }
    throw error;
  }
}
