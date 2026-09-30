import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import {
  categoryNameKey,
  validateCategoryName,
} from "@/lib/categories/validation";
import type { Category } from "@/lib/types";

type CategoryRow = {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function categoryFromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// SQLite's lower() only folds ASCII, so compare names in JS (Ñ/ñ, Á/á).
async function findDuplicate(
  db: Pick<AbstractPowerSyncDatabase, "getAll"> | Pick<Transaction, "getAll">,
  tenantId: string,
  name: string,
  excludedId?: string
) {
  const rows = await db.getAll<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE tenant_id = ?`,
    [tenantId]
  );
  const key = categoryNameKey(name);
  return (
    rows.find(
      (row) => row.id !== excludedId && categoryNameKey(row.name) === key
    ) ?? null
  );
}

export async function createCategoryLocal(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    name: string;
    assertCurrent?: () => void;
  }
): Promise<Category> {
  const name = validateCategoryName(input.name);
  input.assertCurrent?.();
  if (await findDuplicate(db, input.tenantId, name)) {
    throw new Error("Ya existe una categoría con ese nombre.");
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  input.assertCurrent?.();
  await db.execute(
    `INSERT INTO categories
      (id, tenant_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.tenantId, name, now, now]
  );

  return {
    id,
    tenantId: input.tenantId,
    name,
    createdAt: now,
    updatedAt: now,
  };
}

export async function renameCategoryLocal(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    categoryId: string;
    name: string;
    assertCurrent?: () => void;
  }
): Promise<Category> {
  const name = validateCategoryName(input.name);
  input.assertCurrent?.();

  return db.writeTransaction(async (tx) => {
    const rows = await tx.getAll<CategoryRow>(
      `SELECT id, tenant_id, name, created_at, updated_at
       FROM categories WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [input.categoryId, input.tenantId]
    );
    const current = rows[0];
    if (!current) {
      throw new Error("No se encontró la categoría.");
    }
    if (await findDuplicate(tx, input.tenantId, name, input.categoryId)) {
      throw new Error("Ya existe una categoría con ese nombre.");
    }

    const updatedAt = nowIso();
    input.assertCurrent?.();
    // Products reference the category by id, so only the category changes.
    // The server keeps products.category (the denormalized name) in sync.
    await tx.execute(
      `UPDATE categories SET name = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, updatedAt, input.categoryId, input.tenantId]
    );

    return categoryFromRow({ ...current, name, updated_at: updatedAt });
  });
}

export async function deleteCategoryLocal(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    categoryId: string;
    assertCurrent?: () => void;
  }
): Promise<void> {
  input.assertCurrent?.();

  await db.writeTransaction(async (tx) => {
    const rows = await tx.getAll<CategoryRow>(
      `SELECT id, tenant_id, name, created_at, updated_at
       FROM categories WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [input.categoryId, input.tenantId]
    );
    const category = rows[0];
    if (!category) {
      throw new Error("No se encontró la categoría.");
    }

    // Rows from old clients may not be linked by id yet; match those by name.
    const products = await tx.getAll<{
      category_id: string | null;
      category: string;
    }>(
      `SELECT category_id, category FROM products
       WHERE tenant_id = ? AND (category_id = ? OR category_id IS NULL)`,
      [input.tenantId, input.categoryId]
    );
    const key = categoryNameKey(category.name);
    const inUse = products.some(
      (product) =>
        product.category_id === input.categoryId ||
        categoryNameKey(product.category) === key
    );
    if (inUse) {
      throw new Error(
        "Mové los productos a otra categoría antes de eliminarla."
      );
    }

    input.assertCurrent?.();
    await tx.execute(`DELETE FROM categories WHERE id = ? AND tenant_id = ?`, [
      input.categoryId,
      input.tenantId,
    ]);
  });
}
