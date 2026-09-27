"use server";

import { requireExpectedTenantContext } from "@/lib/auth/user-context";
import {
  createSaleForTenant,
  refundSaleForTenant,
  type CreateSaleLineInput,
  voidSaleForTenant,
} from "@/lib/sales/repository";
import type { PaymentMethod } from "@/lib/types";

export type CreateSaleActionInput = {
  paymentMethod: PaymentMethod;
  saleDiscountCents: number;
  saleDiscountReason?: string;
  lines: CreateSaleLineInput[];
};

// Every action takes `expectedTenantId`, the tenant the calling screen
// renders, and refuses to run once another tenant became the active one.

export async function createSale(
  expectedTenantId: string,
  input: CreateSaleActionInput
) {
  const context = await requireExpectedTenantContext(
    expectedTenantId,
    "Se requiere una cuenta para registrar una venta."
  );

  return createSaleForTenant({
    tenantId: context.tenant.id,
    userId: context.user.id,
    userName: context.user.displayName,
    paymentMethod: input.paymentMethod,
    saleDiscountCents: input.saleDiscountCents,
    saleDiscountReason: input.saleDiscountReason,
    lines: input.lines,
  });
}

export async function voidSale(expectedTenantId: string, saleId: string) {
  const context = await requireExpectedTenantContext(
    expectedTenantId,
    "Se requiere una cuenta para anular una venta."
  );

  return voidSaleForTenant({
    tenantId: context.tenant.id,
    userId: context.user.id,
    saleId,
  });
}

export async function refundSale(
  expectedTenantId: string,
  saleId: string,
  reason?: string
) {
  const context = await requireExpectedTenantContext(
    expectedTenantId,
    "Se requiere una cuenta para registrar un reembolso."
  );

  return refundSaleForTenant({
    tenantId: context.tenant.id,
    userId: context.user.id,
    userName: context.user.displayName,
    saleId,
    reason,
  });
}
