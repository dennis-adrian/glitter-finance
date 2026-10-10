import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { UserFacingError } from "@/lib/action-result";
import { sortCategories } from "@/lib/categories";
import {
  categoryNameKey,
  categoryNamesMatch,
  normalizeCategoryName,
  validateCategoryName,
} from "@/lib/categories/validation";
import {
  CATEGORY_NOT_ON_DEVICE_MESSAGE,
  createCategoryLocal,
  deleteCategoryLocal,
  renameCategoryLocal,
  resolveCategoryLocal,
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
  assert.equal(categoryNameKey("  Ñandú   Arte "), "ñandú arte");
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
    getAll: async () => [],
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
  for (const [stored, name] of [
    ["Stickers", "stickers"],
    // SQLite's lower() would miss these: names are compared in JavaScript.
    ["ñandú", " ÑANDÚ "],
  ]) {
    let writes = 0;
    const db = transactionDb({
      getAll: async () => [{ id: "category-1", name: stored }] as never,
      execute: async () => {
        writes += 1;
        return {} as never;
      },
    });

    await assert.rejects(
      createCategoryLocal(db, { tenantId: "tenant-1", name }),
      /Ya existe una categoría/
    );
    assert.equal(writes, 0);
  }
});

test("a product's category is looked up by id among the tenant's", async () => {
  const lookups: unknown[][] = [];
  const found = {
    getOptional: async (_sql: string, parameters?: unknown[]) => {
      lookups.push(parameters ?? []);
      return { id: "category-1", name: "Stickers" } as never;
    },
  };

  assert.deepEqual(
    await resolveCategoryLocal(found, {
      tenantId: "tenant-1",
      categoryId: "category-1",
      hasSynced: true,
    }),
    { id: "category-1", name: "Stickers" }
  );
  assert.deepEqual(lookups, [["category-1", "tenant-1"]]);
  for (const categoryId of ["category-2", null]) {
    await assert.rejects(
      resolveCategoryLocal(
        { getOptional: async () => null },
        { tenantId: "tenant-1", categoryId, hasSynced: true }
      ),
      /Elegí una categoría válida/
    );
  }
});

test("before the first sync a missing category may still be on its way", async () => {
  await assert.rejects(
    resolveCategoryLocal(
      { getOptional: async () => null },
      { tenantId: "tenant-1", categoryId: "category-1", hasSynced: false }
    ),
    (error: unknown) =>
      error instanceof UserFacingError &&
      error.message === CATEGORY_NOT_ON_DEVICE_MESSAGE
  );
});

const storedCategoryId = "11111111-1111-4111-8111-111111111111";
const otherCategoryId = "22222222-2222-4222-8222-222222222222";

function productEditDb(input: { synced: boolean }) {
  const updates: { sql: string; parameters: unknown[] }[] = [];
  const db = {
    currentStatus: { hasSynced: input.synced },
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        // The product is on the device; the tenant has no categories.
        getOptional: async (sql: string) =>
          /FROM products/.test(sql)
            ? { id: "product-1", category_id: storedCategoryId }
            : null,
        execute: async (sql: string, parameters?: unknown[]) => {
          updates.push({ sql, parameters: parameters ?? [] });
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
  // The same category, or none picked (null keeps it).
  for (const categoryId of [storedCategoryId, null]) {
    const { db, updates } = productEditDb({ synced: true });

    await updateProductLocal(db, {
      tenantId: "tenant-1",
      productId: "product-1",
      product: { ...editedProduct, categoryId },
    });

    assert.equal(updates.length, 1);
    assert.doesNotMatch(updates[0].sql, /category/);
  }
});

test("a product edit cannot move it to a category the tenant does not have", async () => {
  for (const synced of [true, false]) {
    const { db, updates } = productEditDb({ synced });

    await assert.rejects(
      updateProductLocal(db, {
        tenantId: "tenant-1",
        productId: "product-1",
        product: { ...editedProduct, categoryId: otherCategoryId },
      }),
      synced ? /Elegí una categoría válida/ : /todavía se están sincronizando/
    );
    assert.equal(updates.length, 0);
  }
});

test("renaming a category only updates the category row", async () => {
  const writes: string[] = [];
  const db = transactionDb({
    getOptional: async () => categoryRow as never,
    // The duplicate-name check: the category itself is excluded.
    getAll: async () => [categoryRow] as never,
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
  // Products follow by id: Postgres renames them, without a newer edit time.
  assert.equal(writes.length, 1);
  assert.match(writes[0], /UPDATE categories/);
});

function deleteDb(
  products: { category_id: string | null; category: string }[]
) {
  const state = { writes: 0, productQuery: [] as unknown[] };
  const db = transactionDb({
    getOptional: async () => categoryRow as never,
    getAll: async (_sql: string, parameters?: unknown[]) => {
      state.productQuery = parameters ?? [];
      return products as never;
    },
    execute: async () => {
      state.writes += 1;
      return {} as never;
    },
  });
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

test("renaming or deleting a category missing from the device says whether it is still syncing", async () => {
  for (const synced of [true, false]) {
    let writes = 0;
    const db = {
      currentStatus: { hasSynced: synced },
      writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
        callback({
          getOptional: async () => null,
          execute: async () => {
            writes += 1;
            return {} as never;
          },
        } as unknown as Transaction),
    } as unknown as AbstractPowerSyncDatabase;
    const expected = (error: unknown) =>
      error instanceof UserFacingError &&
      error.message ===
        (synced
          ? "No se encontró la categoría."
          : CATEGORY_NOT_ON_DEVICE_MESSAGE);

    await assert.rejects(
      renameCategoryLocal(db, {
        tenantId: "tenant-1",
        categoryId: "category-1",
        name: "Pegatinas",
      }),
      expected
    );
    await assert.rejects(
      deleteCategoryLocal(db, {
        tenantId: "tenant-1",
        categoryId: "category-1",
      }),
      expected
    );
    assert.equal(writes, 0);
  }
});
