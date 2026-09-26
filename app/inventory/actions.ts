"use server";

import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { createInventoryMovementForTenant } from "@/lib/inventory/repository";

export async function createInventoryMovement(input: {
  productId: string;
  delta: number;
  reason: string;
  note?: string;
}) {
  const context = await ensureUserTenantContext();

  if (!context?.tenant) {
    throw new Error("Se requiere una cuenta para gestionar el inventario.");
  }

  return createInventoryMovementForTenant({
    tenantId: context.tenant.id,
    userId: context.user.id,
    productId: input.productId,
    delta: input.delta,
    reason: input.reason,
    note: input.note,
  });
}
