import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { UserFacingError } from "@/lib/action-result";
import { INT4_MAX, MAX_PRICE_CENTS } from "@/lib/money";
import {
  createProductLocal,
  updateProductLocal,
} from "@/lib/powersync/write-products";
import {
  normalizeProductInput,
  PRODUCT_CATEGORY_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
} from "@/lib/products";
import type { ProductInput } from "@/lib/types";

const valid: ProductInput = {
  name: "Sticker",
  priceCents: 1500,
  costCents: null,
  category: "Stickers",
};

function recordingDb() {
  const statements: { sql: string; params: unknown[] }[] = [];
  const tx = {
    getOptional: async () => ({ id: "product-1" }),
    execute: async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      return { rowsAffected: 1 };
    },
  } as unknown as Transaction;
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback(tx),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, statements };
}

test("products are trimmed, canonicalized and keep optional-field presence", () => {
  assert.deepEqual(
    normalizeProductInput({
      ...valid,
      name: "  Sticker holo ",
      category: " Pegatinas ",
      costCents: 400,
      imageTone: "coral",
    }),
    {
      name: "Sticker holo",
      priceCents: 1500,
      costCents: 400,
      category: "Stickers",
      imageTone: "coral",
    }
  );

  const update = normalizeProductInput({
    ...valid,
    imagePath: null,
    tracksInventory: true,
    lowStockThreshold: null,
  });
  assert.equal("imagePath" in update, true);
  assert.equal(update.tracksInventory, true);
  assert.equal("lowStockThreshold" in update, true);
  assert.equal("tracksInventory" in normalizeProductInput(valid), false);
});

test("values Postgres would reject or that overflow are refused", () => {
  const invalid: [Partial<Record<keyof ProductInput, unknown>>, RegExp][] = [
    [{ name: "   " }, /nombre/],
    [{ name: "x".repeat(PRODUCT_NAME_MAX_LENGTH + 1) }, /120/],
    [{ category: "" }, /categoría/],
    [{ category: "x".repeat(PRODUCT_CATEGORY_MAX_LENGTH + 1) }, /60/],
    [{ priceCents: -1 }, /precio/],
    [{ priceCents: 12.5 }, /precio/],
    [{ priceCents: Number.NaN }, /precio/],
    [{ priceCents: MAX_PRICE_CENTS + 1 }, /precio/],
    [{ priceCents: INT4_MAX + 1 }, /precio/],
    [{ priceCents: "1500" }, /precio/],
    [{ costCents: -5 }, /costo/],
    [{ costCents: MAX_PRICE_CENTS + 1 }, /costo/],
    [{ lowStockThreshold: -1 }, /umbral/],
    [{ lowStockThreshold: 2.5 }, /umbral/],
    [{ tracksInventory: "yes" }, /producto/],
    [{ imagePath: 42 }, /producto/],
  ];
  for (const [override, message] of invalid) {
    assert.throws(
      () => normalizeProductInput({ ...valid, ...override }),
      (error: unknown) =>
        error instanceof UserFacingError && message.test(error.message),
      JSON.stringify(override)
    );
  }
  assert.throws(() => normalizeProductInput(null), UserFacingError);
  assert.equal(
    normalizeProductInput({ ...valid, priceCents: MAX_PRICE_CENTS }).priceCents,
    MAX_PRICE_CENTS
  );
});

test("the local writers refuse an invalid product without writing", async () => {
  const { db, statements } = recordingDb();

  await assert.rejects(
    createProductLocal(db, {
      tenantId: "tenant-1",
      product: { ...valid, priceCents: 9_999_999_900 },
    }),
    /precio/
  );
  await assert.rejects(
    updateProductLocal(db, {
      tenantId: "tenant-1",
      productId: "product-1",
      product: { ...valid, name: " " },
    }),
    /nombre/
  );
  assert.equal(statements.length, 0);
});

test("a new product always starts with a placeholder image", async () => {
  const { db, statements } = recordingDb();

  await createProductLocal(db, {
    tenantId: "tenant-1",
    product: {
      ...valid,
      name: " Pin ",
      imageTone: "warm",
      imagePath: "other-tenant/products/x/y.png",
    },
  });

  assert.equal(statements.length, 1);
  const params = statements[0].params;
  assert.equal(params[2], "Pin");
  assert.equal(params[6], "placeholder:warm");
});

test("a product and its initial stock are written in one transaction", async () => {
  const statements: string[] = [];
  let transactions = 0;
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) => {
      transactions += 1;
      return callback({
        getOptional: async () => ({ id: "product-1" }),
        execute: async (sql: string) => {
          statements.push(sql);
        },
      } as unknown as Transaction);
    },
  } as unknown as AbstractPowerSyncDatabase;

  const { productId } = await createProductLocal(db, {
    tenantId: "tenant-1",
    product: { ...valid, tracksInventory: true },
    initialStock: { userId: "user-1", delta: 0 },
  });
  await updateProductLocal(db, {
    tenantId: "tenant-1",
    productId: "product-1",
    product: { ...valid, tracksInventory: true },
    initialStock: { userId: "user-1", delta: 4 },
  });

  assert.match(productId, /^[0-9a-f-]{36}$/);
  assert.equal(transactions, 2);
  assert.deepEqual(
    statements.map((sql) => sql.trim().split(/\s+/).slice(0, 3).join(" ")),
    [
      "INSERT INTO products",
      "INSERT INTO inventory_movements",
      "UPDATE products SET",
      "INSERT INTO inventory_movements",
    ]
  );
});

test("an invalid initial stock is refused before the product is written", async () => {
  const { db, statements } = recordingDb();

  await assert.rejects(
    createProductLocal(db, {
      tenantId: "tenant-1",
      product: { ...valid, tracksInventory: true },
      initialStock: { userId: "user-1", delta: -1 },
    }),
    /stock inicial/
  );
  assert.equal(statements.length, 0);
});

test("a product edit only writes the optional fields it was given", async () => {
  const { db, statements } = recordingDb();

  await updateProductLocal(db, {
    tenantId: "tenant-1",
    productId: "product-1",
    product: { ...valid, tracksInventory: true },
  });
  await updateProductLocal(db, {
    tenantId: "tenant-1",
    productId: "product-1",
    product: { ...valid, lowStockThreshold: 3 },
  });

  // The editor has no threshold field: its saves keep the stored one.
  assert.match(statements[0].sql, /tracks_inventory = \?/);
  assert.doesNotMatch(statements[0].sql, /low_stock_threshold/);
  assert.equal(statements[0].params.includes(1), true);
  assert.doesNotMatch(statements[1].sql, /tracks_inventory/);
  assert.match(statements[1].sql, /low_stock_threshold = \?/);
  assert.equal(statements[1].params.includes(3), true);
  for (const { sql, params } of statements) {
    assert.match(sql, /updated_at = \?\s+WHERE id = \? AND tenant_id = \?/);
    assert.deepEqual(params.slice(-2), ["product-1", "tenant-1"]);
  }
});
