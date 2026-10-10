"use server";

import { toActionResult } from "@/lib/action-result";
import { requireExpectedTenantContext } from "@/lib/auth/user-context";
import {
  parseCheckoutRequest,
  type CheckoutRequest,
} from "@/lib/sales/checkout-request";
import {
  createSaleForTenant,
  refundSaleForTenant,
  voidSaleForTenant,
} from "@/lib/sales/repository";
import { requireUuid } from "@/lib/validation";

const SALE_NOT_FOUND_MESSAGE = "No se encontró la venta.";

// Every action takes `expectedTenantId`, the tenant the calling screen
// renders, and refuses to run once another tenant became the active one.
// Arguments come from the browser, so they are checked before any database
// work. Expected failures come back as `{ ok: false, error }`
// (lib/action-result.ts).

export async function createSale(
  expectedTenantId: string,
  input: CheckoutRequest
) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      "Se requiere un puesto para registrar una venta."
    );
    const request = parseCheckoutRequest(input);

    return createSaleForTenant({
      tenantId: context.tenant.id,
      userId: context.user.id,
      userName: context.user.displayName,
      ...request,
    });
  });
}

export async function voidSale(expectedTenantId: string, saleId: string) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      "Se requiere un puesto para anular una venta."
    );

    return voidSaleForTenant({
      tenantId: context.tenant.id,
      userId: context.user.id,
      saleId: requireUuid(saleId, SALE_NOT_FOUND_MESSAGE),
    });
  });
}

export async function refundSale(
  expectedTenantId: string,
  saleId: string,
  reason?: string
) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      "Se requiere un puesto para registrar un reembolso."
    );

    return refundSaleForTenant({
      tenantId: context.tenant.id,
      userId: context.user.id,
      userName: context.user.displayName,
      saleId: requireUuid(saleId, SALE_NOT_FOUND_MESSAGE),
      reason,
    });
  });
}
