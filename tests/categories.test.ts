import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import {
  categoryNameKey,
  categoryNamesMatch,
  normalizeCategoryName,
  validateCategoryName,
} from "@/lib/categories/validation";
import {
  createCategoryLocal,
  deleteCategoryLocal,
  renameCategoryLocal,
} from "@/lib/powersync/write-categories";

const categoryRow = {
  id: "category-1",
  tenant_id: "tenant-1",
  name: "Stickers",
  created_at: "2026-08-14T12:00:00.000Z",
  updated_at: "2026-08-14T12:00:00.000Z",
};

test("normalizes category names and compares them without case", () => {
  assert.equal(normalizeCategoryName("  Arte   impreso  "), "Arte impreso");
  assert.equal(validateCategoryName("  Pines "), "Pines");
  assert.equal(categoryNamesMatch("STICKERS", "stickers"), true);
  assert.equal(categoryNameKey("  Ñandú   Arte "), "ñandú arte");
  assert.throws(() => validateCategoryName("   "), /Escribí un nombre/);
  assert.throws(() => validateCategoryName("x".repeat(41)), /40 caracteres/);
});

test("creates a tenant-owned category in the local PowerSync store", async () => {
  const writes: { sql: string; parameters: unknown[] }[] = [];
  const db = {
    getAll: async () => [],
    execute: async (sql: string, parameters: unknown[]) => {
      writes.push({ sql, parameters });
    },
  } as unknown as AbstractPowerSyncDatabase;

  const created = await createCategoryLocal(db, {
    tenantId: "tenant-1",
    name: "  Cuadernos  ",
  });

  assert.equal(created.tenantId, "tenant-1");
  assert.equal(created.name, "Cuadernos");
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO categories/);
  assert.equal(writes[0].parameters[1], "tenant-1");
});

test("renaming a category only updates the category row", async () => {
  const writes: string[] = [];
  const transaction = {
    // The category itself, then the duplicate-name check (excludes itself).
    getAll: async () => [categoryRow],
    execute: async (sql: string) => {
      writes.push(sql);
    },
  } as unknown as Transaction;
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as AbstractPowerSyncDatabase;

  const renamed = await renameCategoryLocal(db, {
    tenantId: "tenant-1",
    categoryId: "category-1",
    name: "Pegatinas",
  });

  assert.equal(renamed.name, "Pegatinas");
  assert.equal(writes.length, 1);
  assert.match(writes[0], /UPDATE categories/);
});

test("duplicate names are detected beyond ASCII case", async () => {
  const db = {
    getAll: async () => [{ id: "category-2", name: "ñandú" }],
    execute: async () => {
      throw new Error("should not write");
    },
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(
    createCategoryLocal(db, { tenantId: "tenant-1", name: " ÑANDÚ " }),
    /Ya existe una categoría/
  );
});

function deleteDb(
  products: { category_id: string | null; category: string }[]
) {
  let reads = 0;
  const state = { writes: 0, productQuery: [] as unknown[] };
  const transaction = {
    getAll: async (_sql: string, parameters: unknown[]) => {
      reads += 1;
      if (reads === 1) return [categoryRow];
      state.productQuery = parameters;
      return products;
    },
    execute: async () => {
      state.writes += 1;
    },
  } as unknown as Transaction;
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, state };
}

test("does not delete a category used by any product", async () => {
  const cases = [
    // Linked by id (archived products count too).
    [{ category_id: "category-1", category: "Stickers" }],
    // Not linked yet: matched by name.
    [{ category_id: null, category: " STICKERS " }],
  ];

  for (const products of cases) {
    const { db, state } = deleteDb(products);
    await assert.rejects(
      deleteCategoryLocal(db, {
        tenantId: "tenant-1",
        categoryId: "category-1",
      }),
      /Mové los productos/
    );
    assert.deepEqual(state.productQuery, ["tenant-1", "category-1"]);
    assert.equal(state.writes, 0);
  }
});

test("deletes a category no product uses", async () => {
  const { db, state } = deleteDb([{ category_id: null, category: "Prints" }]);

  await deleteCategoryLocal(db, {
    tenantId: "tenant-1",
    categoryId: "category-1",
  });

  assert.equal(state.writes, 1);
});
