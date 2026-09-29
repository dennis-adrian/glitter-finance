"use server";

import { toActionResult } from "@/lib/action-result";
import { requireExpectedTenantContext } from "@/lib/auth/user-context";
import {
  normalizeInventoryMovement,
  type InventoryMovementReason,
} from "@/lib/inventory";
import { addInventoryMovementForTenant } from "@/lib/inventory/repository";
import { requireUuid } from "@/lib/validation";

export type AddInventoryMovementActionInput = {
  productId: string;
  delta: number;
  reason: InventoryMovementReason;
  note?: string;
};

// Takes `expectedTenantId`, the tenant the calling screen renders, and
// refuses to run once another tenant became the active one. Arguments come
// from the browser, so they are checked before any database work, with the
// same rules as the PowerSync writer. Expected failures come back as
// `{ ok: false, error }` (lib/action-result.ts).
export async function addInventoryMovement(
  expectedTenantId: string,
  input: AddInventoryMovementActionInput
) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      "Se requiere un puesto para ajustar el inventario."
    );
    const request: Partial<AddInventoryMovementActionInput> =
      input && typeof input === "object" ? input : {};

    return addInventoryMovementForTenant({
      tenantId: context.tenant.id,
      userId: context.user.id,
      productId: requireUuid(request.productId, "No se encontró el producto."),
      ...normalizeInventoryMovement(request),
    });
  });
}
