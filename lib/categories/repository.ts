// No `import "server-only"` here: lib/products/repository.ts imports this
// module, and scripts/seed-qa.ts imports that one under plain tsx, where the
// marker throws (tests/server-only-marker.test.ts).
import { and, asc, count, eq, notExists, sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { categories, products } from "@/lib/db/schema";
import { postgresErrorCode } from "@/lib/db/errors";
import { validateCategoryName } from "@/lib/categories/validation";
import type { Category } from "@/lib/types";

const CATEGORY_NOT_FOUND_MESSAGE = "No se encontró la categoría.";

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

/**
 * Compatibility bridge for tenants whose products predate categories: every
 * category name their products use becomes one of their categories. It
 * creates categories only from the tenant's own catalog; new or empty tenants
 * still start with none. It reads only the names no category has yet, so once
 * a tenant has them a page load writes nothing.
 */
export async function ensureCategoriesForExistingProducts(tenantId: string) {
  const rows = await db
    .selectDistinct({ name: products.category })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        notExists(
          db
            .select({ id: categories.id })
            .from(categories)
            .where(
              and(
                eq(categories.tenantId, tenantId),
                sql`lower(${categories.name}) = lower(${products.category})`
              )
            )
        )
      )
    );
  const names = new Map<string, string>();

  for (const row of rows) {
    let name: string;
    try {
      name = validateCategoryName(row.name);
    } catch {
      // Blank, too long for a category, or the rails' "Todos": the products
      // keep the name, and their editor asks for a category on a change.
      continue;
    }
    const key = name.toLocaleLowerCase("es");
    if (!names.has(key)) names.set(key, name);
  }

  if (names.size > 0) {
    await db
      .insert(categories)
      .values([...names.values()].map((name) => ({ tenantId, name })))
      .onConflictDoNothing();
  }
}

/** Reads through the caller's transaction, when it has one. */
type CategoryReader = Pick<typeof db, "select">;

/**
 * The tenant's category matching `inputName` (ignoring case), as the tenant
 * spelled it. A product may only be saved in one of the tenant's categories.
 */
export async function resolveCategoryNameForTenant(
  tenantId: string,
  inputName: string,
  reader: CategoryReader = db
) {
  const name = validateCategoryName(inputName);
  const [category] = await reader
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
    throw new UserFacingError("Elegí una categoría válida.");
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
        throw new UserFacingError(CATEGORY_NOT_FOUND_MESSAGE);
      }

      // The app server's clock, like every product write here: Postgres keeps
      // a product column's newer edit
      // (supabase/manual/20260926130100_products_last_write_wins.sql).
      const updatedAt = new Date();
      const [category] = await tx
        .update(categories)
        .set({ name, updatedAt })
        .where(
          and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId))
        )
        .returning();

      if (!category) {
        throw new UserFacingError(CATEGORY_NOT_FOUND_MESSAGE);
      }

      await tx
        .update(products)
        .set({ category: name, updatedAt })
        .where(
          and(
            eq(products.tenantId, tenantId),
            eq(products.category, current.name)
          )
        );

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
      throw new UserFacingError(CATEGORY_NOT_FOUND_MESSAGE);
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
      throw new UserFacingError(
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
