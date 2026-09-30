import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import {
  createProductLocal,
  updateProductLocal,
} from "@/lib/powersync/write-products";
import { createSaleLocal } from "@/lib/powersync/write-sales";
import type { Product, ProductInput } from "@/lib/types";

const input: ProductInput = {
  name: "Sticker",
  priceCents: 1500,
  costCents: null,
  categoryId: "category-2",
  imageTone: "violet",
  tracksInventory: false,
};

function fakeDb(rows: {
  product?: { category_id: string | null };
  categories: { id: string; name: string }[];
}) {
  const reads: string[] = [];
  const writes: { sql: string; parameters: unknown[] }[] = [];
  const getAll = async (sql: string, parameters: unknown[]) => {
    reads.push(sql);
    if (/FROM products/.test(sql)) return rows.product ? [rows.product] : [];
    return rows.categories.filter((row) => row.id === parameters[0]);
  };
  const execute = async (sql: string, parameters: unknown[]) => {
    writes.push({ sql, parameters });
  };
  const db = {
    getAll,
    execute,
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({ getAll, execute } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, reads, writes };
}

test("new products store the category id and its name", async () => {
  const { db, writes } = fakeDb({
    categories: [{ id: "category-2", name: "Prints" }],
  });

  await createProductLocal(db, { tenantId: "tenant-1", product: input });

  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /category_id, category/);
  assert.deepEqual(writes[0].parameters.slice(5, 7), ["category-2", "Prints"]);
});

test("a category that isn't on this device can't be assigned", async () => {
  for (const categoryId of ["category-missing", null]) {
    const { db, writes } = fakeDb({ categories: [] });
    await assert.rejects(
      createProductLocal(db, {
        tenantId: "tenant-1",
        product: { ...input, categoryId },
      }),
      /Seleccioná una categoría válida/
    );
    assert.equal(writes.length, 0);
  }
});

test("edits only write the category when it changes", async () => {
  // Same id, or null ("unchanged"), even when the category isn't synced yet.
  for (const categoryId of ["category-1", null]) {
    const { db, reads, writes } = fakeDb({
      product: { category_id: "category-1" },
      categories: [],
    });
    await updateProductLocal(db, {
      tenantId: "tenant-1",
      productId: "product-1",
      product: { ...input, categoryId },
    });
    assert.equal(reads.filter((sql) => /categories/.test(sql)).length, 0);
    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0].sql, /category/);
  }

  const { db, writes } = fakeDb({
    product: { category_id: "category-1" },
    categories: [{ id: "category-2", name: "Prints" }],
  });
  await updateProductLocal(db, {
    tenantId: "tenant-1",
    productId: "product-1",
    product: input,
  });
  assert.match(writes[0].sql, /category_id = \?, category = \?/);
  assert.deepEqual(writes[0].parameters.slice(3, 5), ["category-2", "Prints"]);
});

test("sale lines snapshot the current category name", async () => {
  const product = {
    id: "product-1",
    name: "Sticker",
    priceCents: 1500,
    costCents: null,
    categoryId: "category-1",
    category: "Stickers",
    archivedAt: null,
  } as Product;
  const cases: [string | undefined, string, string][] = [
    ["Pegatinas", "Stickers", "Pegatinas"],
    [undefined, "Stickers", "Stickers"],
    ["  ", " ", "Sin categoría"],
  ];

  for (const [categoryName, productCategory, expected] of cases) {
    const lineWrites: unknown[][] = [];
    const db = {
      writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
        callback({
          execute: async (sql: string, parameters: unknown[]) => {
            if (/INSERT INTO sale_lines/.test(sql)) lineWrites.push(parameters);
          },
        } as unknown as Transaction),
    } as unknown as AbstractPowerSyncDatabase;

    await createSaleLocal(db, {
      tenantId: "tenant-1",
      userId: "user-1",
      paymentMethod: "cash",
      saleDiscountCents: 0,
      lines: [
        {
          product: { ...product, category: productCategory },
          categoryName,
          quantity: 1,
        },
      ],
    });

    assert.equal(lineWrites.length, 1);
    assert.equal(lineWrites[0][5], expected);
  }
});
