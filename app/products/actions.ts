"use server";

import { ensureUserTenantContext } from "@/lib/auth/user-context";
import {
  archiveProductForTenant,
  createProductForTenant,
  restoreProductForTenant,
  updateProductForTenant,
} from "@/lib/products/repository";
import type { ProductInput } from "@/lib/types";

async function requireTenantId() {
  const context = await ensureUserTenantContext();

  if (!context?.tenant) {
    throw new Error("A tenant is required to manage products.");
  }

  return context.tenant.id;
}

export async function createProduct(input: ProductInput) {
  const tenantId = await requireTenantId();
  return createProductForTenant(tenantId, input);
}

export async function updateProduct(productId: string, input: ProductInput) {
  const tenantId = await requireTenantId();
  return updateProductForTenant(tenantId, productId, input);
}

export async function archiveProduct(productId: string) {
  const tenantId = await requireTenantId();
  return archiveProductForTenant(tenantId, productId);
}

export async function restoreProduct(productId: string) {
  const tenantId = await requireTenantId();
  return restoreProductForTenant(tenantId, productId);
}
