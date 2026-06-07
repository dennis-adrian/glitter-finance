"use server";

import { ensureUserTenantContext } from "@/lib/auth/user-context";
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

export async function createSale(input: CreateSaleActionInput) {
  const context = await ensureUserTenantContext();

  if (!context?.tenant) {
    throw new Error("A tenant is required to create a sale.");
  }

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

export async function voidSale(saleId: string) {
  const context = await ensureUserTenantContext();

  if (!context?.tenant) {
    throw new Error("A tenant is required to void a sale.");
  }

  return voidSaleForTenant({
    tenantId: context.tenant.id,
    userId: context.user.id,
    saleId,
  });
}

export async function refundSale(saleId: string, reason?: string) {
  const context = await ensureUserTenantContext();

  if (!context?.tenant) {
    throw new Error("A tenant is required to refund a sale.");
  }

  return refundSaleForTenant({
    tenantId: context.tenant.id,
    userId: context.user.id,
    userName: context.user.displayName,
    saleId,
    reason,
  });
}
