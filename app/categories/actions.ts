"use server";

import { ensureUserTenantContext } from "@/lib/auth/user-context";
import {
  createCategoryForTenant,
  deleteCategoryForTenant,
  renameCategoryForTenant,
} from "@/lib/categories/repository";

async function requireTenantId() {
  const context = await ensureUserTenantContext();

  if (!context?.tenant) {
    throw new Error("Se requiere una cuenta para gestionar categorías.");
  }

  return context.tenant.id;
}

export async function createCategory(name: string) {
  return createCategoryForTenant(await requireTenantId(), name);
}

export async function renameCategory(categoryId: string, name: string) {
  return renameCategoryForTenant(await requireTenantId(), categoryId, name);
}

export async function deleteCategory(categoryId: string) {
  await deleteCategoryForTenant(await requireTenantId(), categoryId);
}
