import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { validateCategoryName } from "@/lib/categories/validation";
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

async function findDuplicate(
  db: Pick<AbstractPowerSyncDatabase, "getAll"> | Pick<Transaction, "getAll">,
  tenantId: string,
  name: string,
  excludedId?: string
) {
  const rows = await db.getAll<{ id: string }>(
    `SELECT id FROM categories
     WHERE tenant_id = ? AND lower(name) = lower(?)
       AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    [tenantId, name, excludedId ?? null, excludedId ?? null]
  );
  return rows[0] ?? null;
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
    await tx.execute(
      `UPDATE categories SET name = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, updatedAt, input.categoryId, input.tenantId]
    );
    await tx.execute(
      `UPDATE products SET category = ?, updated_at = ?
       WHERE tenant_id = ? AND category = ?`,
      [name, updatedAt, input.tenantId, current.name]
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

    const usedBy = await tx.getAll<{ id: string }>(
      `SELECT id FROM products
       WHERE tenant_id = ? AND category = ? LIMIT 1`,
      [input.tenantId, category.name]
    );
    if (usedBy.length > 0) {
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
