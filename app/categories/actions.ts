"use server";

import { toActionResult } from "@/lib/action-result";
import { requireExpectedTenantContext } from "@/lib/auth/user-context";
import {
  createCategoryForTenant,
  deleteCategoryForTenant,
  renameCategoryForTenant,
} from "@/lib/categories/repository";
import { requireUuid } from "@/lib/validation";

const CATEGORY_NOT_FOUND_MESSAGE = "No se encontró la categoría.";

// Every action takes `expectedTenantId`, the tenant the calling screen
// renders, and refuses to run once another tenant became the active one.
// Arguments come from the browser, so they are checked before any database
// work, with the same rules as the PowerSync writers (validateCategoryName).
// Expected failures come back as `{ ok: false, error }` (lib/action-result.ts).
async function requireTenantId(expectedTenantId: string) {
  const context = await requireExpectedTenantContext(
    expectedTenantId,
    "Se requiere un puesto para gestionar categorías."
  );
  return context.tenant.id;
}

export async function createCategory(expectedTenantId: string, name: string) {
  return toActionResult(async () =>
    createCategoryForTenant(await requireTenantId(expectedTenantId), name)
  );
}

export async function renameCategory(
  expectedTenantId: string,
  categoryId: string,
  name: string
) {
  return toActionResult(async () =>
    renameCategoryForTenant(
      await requireTenantId(expectedTenantId),
      requireUuid(categoryId, CATEGORY_NOT_FOUND_MESSAGE),
      name
    )
  );
}

export async function deleteCategory(
  expectedTenantId: string,
  categoryId: string
) {
  return toActionResult(async () => {
    await deleteCategoryForTenant(
      await requireTenantId(expectedTenantId),
      requireUuid(categoryId, CATEGORY_NOT_FOUND_MESSAGE)
    );
  });
}
