import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, products } from "@/lib/db/schema";
import { postgresErrorCode } from "@/lib/db/errors";
import { validateCategoryName } from "@/lib/categories/validation";
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

function categoryInUseError() {
  return new Error("Mové los productos a otra categoría antes de eliminarla.");
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getCategoryForTenant(
  tenantId: string,
  categoryId: string | null | undefined
) {
  if (!categoryId || !uuidPattern.test(categoryId)) {
    throw new Error("Seleccioná una categoría válida.");
  }
  const [category] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
    )
    .limit(1);

  if (!category) {
    throw new Error("Seleccioná una categoría válida.");
  }

  return category;
}

/** For payloads from clients that still send the category by name. */
export async function findCategoryByNameForTenant(
  tenantId: string,
  inputName: string
) {
  const name = validateCategoryName(inputName);
  const [category] = await db
    .select({ id: categories.id, name: categories.name })
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

  return category;
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

      const [category] = await tx
        .update(categories)
        .set({ name, updatedAt: new Date() })
        .where(
          and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
        )
        .returning();

      // The categories_cascade_name_to_products trigger already does this;
      // kept for databases without the manual SQL. It is a maintenance write,
      // so updated_at stays as is.
      await tx
        .update(products)
        .set({ category: name })
        .where(
          and(
            eq(products.tenantId, tenantId),
            eq(products.categoryId, categoryId),
            sql`${products.category} IS DISTINCT FROM ${name}`
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

    // Rows from old clients may not be linked by id yet; match those by name.
    const [usage] = await tx
      .select({ value: count() })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          or(
            eq(products.categoryId, categoryId),
            and(
              isNull(products.categoryId),
              sql`lower(${products.category}) = lower(${category.name})`
            )
          )
        )
      );

    if ((usage?.value ?? 0) > 0) {
      throw categoryInUseError();
    }

    try {
      await tx
        .delete(categories)
        .where(
          and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
        );
    } catch (error) {
      if (postgresErrorCode(error) === "23503") {
        throw categoryInUseError();
      }
      throw error;
    }
  });
}
