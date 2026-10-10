// No `import "server-only"` here: lib/products/repository.ts imports this
// module, and scripts/seed-qa.ts imports that one under plain tsx, where the
// marker throws (tests/server-only-marker.test.ts).
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { categories, products } from "@/lib/db/schema";
import { postgresErrorCode } from "@/lib/db/errors";
import { validateCategoryName } from "@/lib/categories/validation";
import type { Category } from "@/lib/types";
import { isUuid } from "@/lib/validation";

const CATEGORY_NOT_FOUND_MESSAGE = "No se encontró la categoría.";
const INVALID_CATEGORY_MESSAGE = "Elegí una categoría válida.";

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
    throw new UserFacingError("Ya existe una categoría con ese nombre.", {
      cause: error,
    });
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

/** Reads through the caller's transaction, when it has one. */
type CategoryReader = Pick<typeof db, "select">;

/**
 * The tenant's category with id `categoryId`, with its current name. A
 * product may only be saved in one of the tenant's categories; the composite
 * foreign key on products.category_id enforces the same in Postgres.
 */
export async function getCategoryForTenant(
  tenantId: string,
  categoryId: string | null | undefined,
  reader: CategoryReader = db
): Promise<{ id: string; name: string }> {
  if (!isUuid(categoryId)) {
    throw new UserFacingError(INVALID_CATEGORY_MESSAGE);
  }
  const [category] = await reader
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(
        eq(categories.tenantId, tenantId),
        eq(categories.id, categoryId.toLowerCase())
      )
    )
    .limit(1);

  if (!category) {
    throw new UserFacingError(INVALID_CATEGORY_MESSAGE);
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
      const [category] = await tx
        .update(categories)
        .set({ name, updatedAt: new Date() })
        .where(
          and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
        )
        .returning();

      if (!category) {
        throw new UserFacingError(CATEGORY_NOT_FOUND_MESSAGE);
      }

      // The categories_cascade_name_to_products trigger already does this;
      // kept for databases without the manual SQL
      // (supabase/manual/20261009120000_product_category_ids.sql). Products
      // follow their category by id, and the name is a maintenance write, so
      // updated_at stays as is: a newer edit on another device keeps its
      // per-column time (products_keep_latest_edit).
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

      return mapCategory(category);
    });
  } catch (error) {
    return categoryConflictError(error);
  }
}

const CATEGORY_IN_USE_MESSAGE =
  "Mové los productos a otra categoría antes de eliminarla.";

export async function deleteCategoryForTenant(
  tenantId: string,
  categoryId: string
): Promise<void> {
  try {
    await deleteUnusedCategory(tenantId, categoryId);
  } catch (error) {
    // A product filed under it after the check below: Postgres refuses the
    // delete (products_category_id_tenant_id_categories_id_tenant_id_fk).
    if (postgresErrorCode(error) === "23503") {
      throw new UserFacingError(CATEGORY_IN_USE_MESSAGE, { cause: error });
    }
    throw error;
  }
}

async function deleteUnusedCategory(tenantId: string, categoryId: string) {
  await db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(categories)
      .where(
        and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
      )
      .limit(1);

    if (!category) {
      throw new UserFacingError(CATEGORY_NOT_FOUND_MESSAGE);
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
      throw new UserFacingError(CATEGORY_IN_USE_MESSAGE);
    }

    await tx
      .delete(categories)
      .where(
        and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
      );
  });
}
