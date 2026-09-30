// Local-first category writes. Mirror lib/categories/repository.ts, but write
// to the per-device PowerSync SQLite store; PowerSync's CRUD queue uploads
// the changes to Supabase via SupabaseConnector.uploadData.
//
// A rename also renames the category on this device's products, setting their
// updated_at like every product UPDATE (see lib/powersync/write-products.ts).
// Postgres renames them too (supabase/manual/
// 20260814235910_category_integrity_triggers.sql), for products this device
// has not synced yet.

import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { UserFacingError } from "@/lib/action-result";
import { validateCategoryName } from "@/lib/categories/validation";
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

async function findDuplicate(
  tx: Pick<Transaction, "getOptional">,
  tenantId: string,
  name: string,
  excludedId?: string
) {
  return tx.getOptional<{ id: string }>(
    `SELECT id FROM categories
     WHERE tenant_id = ? AND lower(name) = lower(?)
       AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    [tenantId, name, excludedId ?? null, excludedId ?? null]
  );
}

async function findCategory(
  tx: Pick<Transaction, "getOptional">,
  input: { tenantId: string; categoryId: string }
) {
  const row = await tx.getOptional<LocalCategoryRow>(
    `SELECT id, tenant_id, name, created_at, updated_at
     FROM categories WHERE id = ? AND tenant_id = ?`,
    [input.categoryId, input.tenantId]
  );
  if (!row) {
    throw new UserFacingError(CATEGORY_NOT_FOUND_MESSAGE);
  }
  return row;
}

/**
 * The tenant's category matching `inputName` (ignoring case), as the tenant
 * spelled it: the local counterpart of resolveCategoryNameForTenant, for the
 * product writers' transactions. `hasSynced` is whether the device has
 * completed its first sync, and so holds every category.
 */
export async function resolveCategoryNameLocal(
  tx: Pick<Transaction, "getOptional">,
  input: { tenantId: string; name: string; hasSynced: boolean }
) {
  const name = validateCategoryName(input.name);
  const row = await tx.getOptional<{ name: string }>(
    `SELECT name FROM categories
     WHERE tenant_id = ? AND lower(name) = lower(?)
     LIMIT 1`,
    [input.tenantId, name]
  );
  if (!row) {
    throw new UserFacingError(
      input.hasSynced
        ? "Elegí una categoría válida."
        : CATEGORY_NOT_ON_DEVICE_MESSAGE
    );
  }
  return row.name;
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
    const current = await findCategory(tx, input);
    if (await findDuplicate(tx, input.tenantId, name, input.categoryId)) {
      throw new UserFacingError(DUPLICATE_CATEGORY_MESSAGE);
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
    const category = await findCategory(tx, input);

    const usedBy = await tx.getOptional<{ id: string }>(
      `SELECT id FROM products
       WHERE tenant_id = ? AND category = ? LIMIT 1`,
      [input.tenantId, category.name]
    );
    if (usedBy) {
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
