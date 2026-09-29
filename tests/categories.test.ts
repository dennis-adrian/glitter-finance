import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import {
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

test("renaming a category updates the category and its products together", async () => {
  const writes: string[] = [];
  let reads = 0;
  const transaction = {
    getAll: async () => {
      reads += 1;
      return reads === 1 ? [categoryRow] : [];
    },
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
  assert.equal(writes.length, 2);
  assert.match(writes[0], /UPDATE categories/);
  assert.match(writes[1], /UPDATE products/);
});

test("does not delete a category used by any product", async () => {
  let reads = 0;
  let writes = 0;
  const transaction = {
    getAll: async () => {
      reads += 1;
      return reads === 1 ? [categoryRow] : [{ id: "archived-product" }];
    },
    execute: async () => {
      writes += 1;
    },
  } as unknown as Transaction;
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(
    deleteCategoryLocal(db, {
      tenantId: "tenant-1",
      categoryId: "category-1",
    }),
    /Mové los productos/
  );
  assert.equal(writes, 0);
});
