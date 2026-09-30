import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { UserFacingError } from "@/lib/action-result";
import { sortCategories } from "@/lib/categories";
import {
  categoryNamesMatch,
  normalizeCategoryName,
  validateCategoryName,
} from "@/lib/categories/validation";
import {
  CATEGORY_NOT_ON_DEVICE_MESSAGE,
  createCategoryLocal,
  deleteCategoryLocal,
  renameCategoryLocal,
  resolveCategoryNameLocal,
} from "@/lib/powersync/write-categories";
import { updateProductLocal } from "@/lib/powersync/write-products";

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
  assert.equal(validateCategoryName("😀".repeat(40)).length, 80);
});

test("categories are listed by name, ignoring case and accents", () => {
  const names = ["pines", "Stickers", "Álbumes", "Arte", "láminas"];
  assert.deepEqual(
    sortCategories(names.map((name) => ({ name }))).map((item) => item.name),
    ["Álbumes", "Arte", "láminas", "pines", "Stickers"]
  );
});

test("refuses category names Postgres or the category rails would reject", () => {
  const invalid: [unknown, RegExp][] = [
    ["   ", /Escribí un nombre/],
    ["x".repeat(41), /40 caracteres/],
    [42, /no es válido/],
    // The rails' show-everything filter.
    [" todos ", /Elegí otro nombre/],
  ];
  for (const [value, message] of invalid) {
    assert.throws(
      () => validateCategoryName(value),
      (error: unknown) =>
        error instanceof UserFacingError && message.test(error.message),
      String(value)
    );
  }
});

function transactionDb(transaction: Partial<Transaction>) {
  return {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback(transaction as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
}

test("creates a tenant-owned category in the local PowerSync store", async () => {
  const writes: { sql: string; parameters: unknown[] }[] = [];
  const db = transactionDb({
    getOptional: async () => null,
    execute: async (sql: string, parameters?: unknown[]) => {
      writes.push({ sql, parameters: parameters ?? [] });
      return {} as never;
    },
  });

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

test("a category that already exists on the device is not created twice", async () => {
  let writes = 0;
  const db = transactionDb({
    getOptional: async () => ({ id: "category-1" }) as never,
    execute: async () => {
      writes += 1;
      return {} as never;
    },
  });

  await assert.rejects(
    createCategoryLocal(db, { tenantId: "tenant-1", name: "stickers" }),
    /Ya existe una categoría/
  );
  assert.equal(writes, 0);
});

test("a product takes the tenant's spelling of its category", async () => {
  const lookups: unknown[][] = [];
  const found = {
    getOptional: async (_sql: string, parameters?: unknown[]) => {
      lookups.push(parameters ?? []);
      return { name: "Stickers" } as never;
    },
  };

  assert.equal(
    await resolveCategoryNameLocal(found, {
      tenantId: "tenant-1",
      name: "  stickers ",
      hasSynced: true,
    }),
    "Stickers"
  );
  assert.deepEqual(lookups, [["tenant-1", "stickers"]]);
  await assert.rejects(
    resolveCategoryNameLocal(
      { getOptional: async () => null },
      { tenantId: "tenant-1", name: "Otra", hasSynced: true }
    ),
    /Elegí una categoría válida/
  );
});

test("before the first sync a missing category may still be on its way", async () => {
  await assert.rejects(
    resolveCategoryNameLocal(
      { getOptional: async () => null },
      { tenantId: "tenant-1", name: "Stickers", hasSynced: false }
    ),
    (error: unknown) =>
      error instanceof UserFacingError &&
      error.message === CATEGORY_NOT_ON_DEVICE_MESSAGE
  );
});

function productEditDb(input: { storedCategory: string; synced: boolean }) {
  const updates: unknown[][] = [];
  const db = {
    currentStatus: { hasSynced: input.synced },
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        // The product is on the device; the tenant has no categories.
        getOptional: async (sql: string) =>
          /FROM products/.test(sql)
            ? { id: "product-1", category: input.storedCategory }
            : null,
        execute: async (_sql: string, parameters?: unknown[]) => {
          updates.push(parameters ?? []);
          return {} as never;
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, updates };
}

const editedProduct = {
  name: "Sticker",
  priceCents: 1500,
  costCents: null,
  imageTone: "violet" as const,
};

test("a product edit keeps a category the tenant no longer has", async () => {
  const { db, updates } = productEditDb({
    storedCategory: "Retirada",
    synced: true,
  });

  await updateProductLocal(db, {
    tenantId: "tenant-1",
    productId: "product-1",
    product: { ...editedProduct, category: "Retirada" },
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], "Retirada");
});

test("a product edit cannot move it to a category the tenant does not have", async () => {
  for (const synced of [true, false]) {
    const { db, updates } = productEditDb({
      storedCategory: "Stickers",
      synced,
    });

    await assert.rejects(
      updateProductLocal(db, {
        tenantId: "tenant-1",
        productId: "product-1",
        product: { ...editedProduct, category: "Otra" },
      }),
      synced ? /Elegí una categoría válida/ : /todavía se están sincronizando/
    );
    assert.equal(updates.length, 0);
  }
});

test("renaming a category updates the category and its products together", async () => {
  const writes: string[] = [];
  let reads = 0;
  const db = transactionDb({
    getOptional: async () => {
      reads += 1;
      return (reads === 1 ? categoryRow : null) as never;
    },
    execute: async (sql: string) => {
      writes.push(sql);
      return {} as never;
    },
  });

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
  const db = transactionDb({
    getOptional: async () => {
      reads += 1;
      return (reads === 1 ? categoryRow : { id: "archived-product" }) as never;
    },
    execute: async () => {
      writes += 1;
      return {} as never;
    },
  });

  await assert.rejects(
    deleteCategoryLocal(db, {
      tenantId: "tenant-1",
      categoryId: "category-1",
    }),
    /Mové los productos/
  );
  assert.equal(writes, 0);
});
