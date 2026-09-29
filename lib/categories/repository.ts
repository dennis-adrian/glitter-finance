import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, products } from "@/lib/db/schema";
import { postgresErrorCode } from "@/lib/db/errors";
import {
  categoryNameMaxLength,
  normalizeCategoryName,
  validateCategoryName,
} from "@/lib/categories/validation";
import type { Category } from "@/lib/types";

function mapCategory(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function categoryConflictError(error: unknown): never {
  if (postgresErrorCode(error) === "23505") {
    throw new Error("Ya existe una categoría con ese nombre.");
  }
  throw error;
}

export async function getCategoriesForTenant(
  tenantId: string
): Promise<Category[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))
    .orderBy(asc(categories.name));

  return rows.map(mapCategory);
}

/**
 * One-time compatibility bridge for tenants that already had products before
 * categories became first-class records. It creates categories only from the
 * tenant's own catalog; new/empty tenants still start with no defaults.
 */
export async function ensureCategoriesForExistingProducts(tenantId: string) {
  const rows = await db
    .selectDistinct({ name: products.category })
    .from(products)
    .where(eq(products.tenantId, tenantId));
  const names = new Map<string, string>();

  for (const row of rows) {
    const name = normalizeCategoryName(row.name);
    if (!name || name.length > categoryNameMaxLength) continue;
    if (!names.has(name.toLocaleLowerCase("es"))) {
      names.set(name.toLocaleLowerCase("es"), name);
    }
  }

  if (names.size > 0) {
    await db
      .insert(categories)
      .values(
        [...names.values()].map((name) => ({
          tenantId,
          name,
        }))
      )
      .onConflictDoNothing();
  }
}

export async function resolveCategoryNameForTenant(
  tenantId: string,
  inputName: string
) {
  const name = validateCategoryName(inputName);
  const [category] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(
      and(
        eq(categories.tenantId, tenantId),
        sql`lower(${categories.name}) = lower(${name})`
      )
    )
    .limit(1);

  if (!category) {
    throw new Error("Seleccioná una categoría válida.");
  }

  return category.name;
}

export async function createCategoryForTenant(
  tenantId: string,
  inputName: string
): Promise<Category> {
  const name = validateCategoryName(inputName);

  try {
    const [category] = await db
      .insert(categories)
      .values({ tenantId, name })
      .returning();

    if (!category) {
      throw new Error("No se pudo crear la categoría.");
    }

    return mapCategory(category);
  } catch (error) {
    return categoryConflictError(error);
  }
}

export async function renameCategoryForTenant(
  tenantId: string,
  categoryId: string,
  inputName: string
): Promise<Category> {
  const name = validateCategoryName(inputName);

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(categories)
        .where(
          and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
        )
        .limit(1);

      if (!current) {
        throw new Error("No se encontró la categoría.");
      }

      const updatedAt = new Date();
      const [category] = await tx
        .update(categories)
        .set({ name, updatedAt })
        .where(
          and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
        )
        .returning();

      await tx
        .update(products)
        .set({ category: name, updatedAt })
        .where(
          and(
            eq(products.tenantId, tenantId),
            eq(products.category, current.name)
          )
        );

      if (!category) {
        throw new Error("No se pudo renombrar la categoría.");
      }

      return mapCategory(category);
    });
  } catch (error) {
    return categoryConflictError(error);
  }
}

export async function deleteCategoryForTenant(
  tenantId: string,
  categoryId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(categories)
      .where(
        and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
      )
      .limit(1);

    if (!category) {
      throw new Error("No se encontró la categoría.");
    }

    const [usage] = await tx
      .select({ value: count() })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.category, category.name)
        )
      );

    if ((usage?.value ?? 0) > 0) {
      throw new Error(
        "Mové los productos a otra categoría antes de eliminarla."
      );
    }

    await tx
      .delete(categories)
      .where(
        and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
      );
  });
}
