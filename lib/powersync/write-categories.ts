// Local-first category writes. Mirror lib/categories/repository.ts, but write
// to the per-device PowerSync SQLite store; PowerSync's CRUD queue uploads
// the changes to Supabase via SupabaseConnector.uploadData.
//
// Products reference their category by id (products.category_id), so a
// rename changes only the category row. Postgres copies the new name onto
// the products (categories_cascade_name_to_products in supabase/manual/
// 20261009120000_product_category_ids.sql) without giving them a newer edit
// time, and the device gets them back at the next sync; until then the
// screens label products from their category (categoryLabel in
// lib/products.ts).

import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { UserFacingError } from "@/lib/action-result";
import {
  categoryNameKey,
  validateCategoryName,
} from "@/lib/categories/validation";
import { nowIso } from "@/lib/dates";
import {
  mapLocalCategoryRow,
  type LocalCategoryRow,
} from "@/lib/powersync/categories-from-local";
import type { Category } from "@/lib/types";

const CATEGORY_NOT_FOUND_MESSAGE = "No se encontró la categoría.";
const DUPLICATE_CATEGORY_MESSAGE = "Ya existe una categoría con ese nombre.";

/**
 * Before the first sync completes, the local store holds only this device's
 * own categories, so one listed from the server-rendered catalog may not be
 * there yet (like PRODUCT_NOT_ON_DEVICE_MESSAGE for products).
 */
export const CATEGORY_NOT_ON_DEVICE_MESSAGE =
  "Las categorías todavía se están sincronizando en este dispositivo. Intentalo de nuevo en un momento.";

// SQLite's lower() only folds ASCII letters, so names are compared in
// JavaScript (Ñ/ñ, Á/á), like Postgres' lower() does on the server.
async function findDuplicate(
  tx: Pick<Transaction, "getAll">,
  tenantId: string,
  name: string,
  excludedId?: string
) {
  const rows = await tx.getAll<{ id: string; name: string }>(
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

function hasSynced(db: Pick<AbstractPowerSyncDatabase, "currentStatus">) {
  return db.currentStatus?.hasSynced ?? false;
}

/**
 * The category being renamed or deleted. `hasSynced` is whether the device
 * has completed its first sync: before it, a category listed from the
 * server-rendered catalog may simply not be on this device yet.
 */
async function findCategory(
  tx: Pick<Transaction, "getOptional">,
  input: { tenantId: string; categoryId: string; hasSynced: boolean }
) {
  const row = await tx.getOptional<LocalCategoryRow>(
    `SELECT id, tenant_id, name, created_at, updated_at
     FROM categories WHERE id = ? AND tenant_id = ?`,
    [input.categoryId, input.tenantId]
  );
  if (!row) {
    throw new UserFacingError(
      input.hasSynced
        ? CATEGORY_NOT_FOUND_MESSAGE
        : CATEGORY_NOT_ON_DEVICE_MESSAGE
    );
  }
  return row;
}

/**
 * The tenant's category with id `categoryId`, with its current name: the
 * local counterpart of getCategoryForTenant, for the product writers'
 * transactions. `hasSynced` is whether the device has completed its first
 * sync, and so holds every category.
 */
export async function resolveCategoryLocal(
  tx: Pick<Transaction, "getOptional">,
  input: { tenantId: string; categoryId: string | null; hasSynced: boolean }
) {
  const row = input.categoryId
    ? await tx.getOptional<{ id: string; name: string }>(
        `SELECT id, name FROM categories WHERE id = ? AND tenant_id = ?`,
        [input.categoryId, input.tenantId]
      )
    : null;
  if (!row) {
    throw new UserFacingError(
      input.hasSynced || !input.categoryId
        ? "Elegí una categoría válida."
        : CATEGORY_NOT_ON_DEVICE_MESSAGE
    );
  }
  return row;
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
  const now = nowIso();
  const category: Category = {
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    name,
    createdAt: now,
    updatedAt: now,
  };

  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    if (await findDuplicate(tx, input.tenantId, name)) {
      throw new UserFacingError(DUPLICATE_CATEGORY_MESSAGE);
    }
    input.assertCurrent?.();
    await tx.execute(
      `INSERT INTO categories
        (id, tenant_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        category.id,
        category.tenantId,
        category.name,
        category.createdAt,
        category.updatedAt,
      ]
    );
  });

  return category;
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

  return db.writeTransaction(async (tx) => {
    const current = await findCategory(tx, {
      tenantId: input.tenantId,
      categoryId: input.categoryId,
      hasSynced: hasSynced(db),
    });
    if (await findDuplicate(tx, input.tenantId, name, input.categoryId)) {
      throw new UserFacingError(DUPLICATE_CATEGORY_MESSAGE);
    }

    const updatedAt = nowIso();
    input.assertCurrent?.();
    // One statement: the products follow by id (see the header). Rewriting
    // their names here would give them this device's edit time, and would
    // still upload when the server drops a rename that lost to another
    // device's (isLostCategoryConflict in lib/powersync/connector.ts).
    await tx.execute(
      `UPDATE categories SET name = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, updatedAt, input.categoryId, input.tenantId]
    );

    return mapLocalCategoryRow({ ...current, name, updated_at: updatedAt });
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
  await db.writeTransaction(async (tx) => {
    const category = await findCategory(tx, {
      tenantId: input.tenantId,
      categoryId: input.categoryId,
      hasSynced: hasSynced(db),
    });

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
      throw new UserFacingError(
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
