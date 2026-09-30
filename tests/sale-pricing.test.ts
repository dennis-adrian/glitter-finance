import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { UserFacingError } from "@/lib/action-result";
import { MAX_QUANTITY } from "@/lib/inventory";
import { INT4_MAX } from "@/lib/money";
import { createSaleLocal } from "@/lib/powersync/write-sales";
import {
  cartSubtotalCents,
  MAX_SALE_LINES,
  mergeSaleLines,
  priceLine,
  priceSale,
  saleTotalCents,
  type PricingProduct,
  type SaleRequest,
} from "@/lib/sales/pricing";
import type { Product } from "@/lib/types";
import { MAX_NOTE_LENGTH } from "@/lib/validation";

function product(
  id: string,
  priceCents: number,
  extra: Partial<Product> = {}
): Product {
  return {
    id,
    name: `Producto ${id}`,
    priceCents,
    costCents: 300,
    category: "Stickers",
    imagePath: null,
    imageUrl: null,
    imageTone: "violet",
    tracksInventory: false,
    lowStockThreshold: null,
    archivedAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...extra,
  };
}

const sticker = product("p1", 1000);
const print = product("p2", 2500, { costCents: null, category: "Láminas" });

function catalog(...products: PricingProduct[]) {
  return new Map(products.map((item) => [item.id, item]));
}

function rejectsWith(run: () => unknown, message: RegExp) {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof UserFacingError && message.test(error.message),
    String(message)
  );
}

test("a sale is priced with clamped line and sale discounts", () => {
  const sale = priceSale(
    {
      lines: [
        { productId: "p1", quantity: 3, lineDiscountCents: 500 },
        { productId: "p2", quantity: 1, lineDiscountCents: 9_000 },
      ],
      saleDiscountCents: 100_000,
      saleDiscountReason: "  cliente frecuente ",
    },
    catalog(sticker, print)
  );

  assert.deepEqual(sale, {
    lines: [
      {
        productId: "p1",
        productName: "Producto p1",
        category: "Stickers",
        quantity: 3,
        unitPriceCents: 1000,
        unitCostCents: 300,
        lineDiscountCents: 500,
        lineDiscountReason: null,
        lineTotalCents: 2500,
      },
      {
        productId: "p2",
        productName: "Producto p2",
        // Snapshotted as the product has it.
        category: "Láminas",
        quantity: 1,
        unitPriceCents: 2500,
        unitCostCents: null,
        lineDiscountCents: 2500,
        lineDiscountReason: null,
        lineTotalCents: 0,
      },
    ],
    subtotalCents: 2500,
    saleDiscountCents: 2500,
    saleDiscountReason: "cliente frecuente",
    totalCents: 0,
  });
});

test("lines for the same product merge, keeping the first reason", () => {
  assert.deepEqual(
    mergeSaleLines([
      { productId: "p1", quantity: 1, lineDiscountReason: "  " },
      { productId: "p2", quantity: 2 },
      {
        productId: "p1",
        quantity: 2,
        lineDiscountCents: 300,
        lineDiscountReason: "dañado",
      },
      {
        productId: "p1",
        quantity: 1,
        lineDiscountCents: 200,
        lineDiscountReason: "otro",
      },
    ]),
    [
      {
        productId: "p1",
        quantity: 4,
        lineDiscountCents: 500,
        lineDiscountReason: "dañado",
      },
      {
        productId: "p2",
        quantity: 2,
        lineDiscountCents: 0,
        lineDiscountReason: null,
      },
    ]
  );
});

test("sales Postgres would reject are refused before any write", () => {
  const products = catalog(
    sticker,
    print,
    product("archived", 1000, { archivedAt: "2026-09-02T10:00:00.000Z" }),
    product("pricey", 100_000_000),
    product("broken", Number.NaN)
  );
  const request = (overrides: Partial<SaleRequest>): SaleRequest => ({
    lines: [{ productId: "p1", quantity: 1 }],
    saleDiscountCents: 0,
    ...overrides,
  });

  const cases: [SaleRequest, RegExp][] = [
    [request({ lines: [] }), /al menos un producto/],
    [request({ lines: [{ productId: "", quantity: 1 }] }), /producto/],
    [request({ lines: [{ productId: "p1", quantity: 0 }] }), /cantidades/],
    [request({ lines: [{ productId: "p1", quantity: 1.5 }] }), /cantidades/],
    [
      request({
        lines: [
          { productId: "p1", quantity: MAX_QUANTITY },
          { productId: "p1", quantity: 1 },
        ],
      }),
      /cantidades/,
    ],
    [request({ saleDiscountCents: Number.NaN }), /descuentos/],
    [request({ saleDiscountCents: -1 }), /descuentos/],
    [request({ saleDiscountCents: 12.5 }), /descuentos/],
    [
      request({
        lines: [{ productId: "p1", quantity: 1, lineDiscountCents: NaN }],
      }),
      /descuentos/,
    ],
    [
      request({ saleDiscountReason: "x".repeat(MAX_NOTE_LENGTH + 1) }),
      /motivo/,
    ],
    [request({ lines: [{ productId: "gone", quantity: 1 }] }), /disponibles/],
    [
      request({ lines: [{ productId: "archived", quantity: 1 }] }),
      /archivados/,
    ],
    [
      request({ lines: [{ productId: "broken", quantity: 1 }] }),
      /no es válido/,
    ],
    // 100.000.000 × 22 cents overflows the integer line columns.
    [request({ lines: [{ productId: "pricey", quantity: 22 }] }), /máximo/],
    [
      request({
        lines: [
          { productId: "pricey", quantity: 20 },
          { productId: "p2", quantity: 60_000 },
        ],
      }),
      /total de la venta/,
    ],
    [
      request({
        lines: Array.from({ length: MAX_SALE_LINES + 1 }, (_, index) => ({
          productId: `p${index}`,
          quantity: 1,
        })),
      }),
      /productos distintos/,
    ],
  ];

  for (const [input, message] of cases) {
    rejectsWith(() => priceSale(input, products), message);
  }

  const atLimit = priceSale(
    request({ lines: [{ productId: "pricey", quantity: 21 }] }),
    products
  );
  assert.ok(atLimit.subtotalCents <= INT4_MAX);
});

test("the cart shows the same line totals the sale records", () => {
  const cart = [
    { product: sticker, quantity: 3, lineDiscountCents: 500 },
    { product: print, quantity: 2, lineDiscountCents: 99_999 },
    { product: sticker, quantity: 1 },
  ];

  assert.deepEqual(
    priceLine({ priceCents: 1000, quantity: 3, lineDiscountCents: 500 }),
    { grossCents: 3000, discountCents: 500, totalCents: 2500 }
  );
  assert.equal(cartSubtotalCents(cart), 2500 + 0 + 1000);
  assert.equal(saleTotalCents(3500, 500), 3000);
  assert.equal(saleTotalCents(3500, 9000), 0);
  assert.equal(saleTotalCents(3500, Number.NaN), 3500);
});

function recordingDb() {
  const statements: { sql: string; params: unknown[] }[] = [];
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        execute: async (sql: string, params: unknown[] = []) => {
          statements.push({ sql, params });
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, statements };
}

test("the PowerSync writer records exactly the shared pricing", async () => {
  const { db, statements } = recordingDb();
  const input = {
    tenantId: "tenant-1",
    userId: "user-1",
    paymentMethod: "cash" as const,
    saleDiscountCents: 700,
    saleDiscountReason: "redondeo",
    lines: [
      { product: sticker, quantity: 2, lineDiscountCents: 150 },
      { product: print, quantity: 1, lineDiscountReason: "dañado" },
      { product: sticker, quantity: 1 },
    ],
  };

  const result = await createSaleLocal(db, input);
  const expected = priceSale(
    {
      lines: input.lines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        lineDiscountCents: line.lineDiscountCents,
        lineDiscountReason: line.lineDiscountReason,
      })),
      saleDiscountCents: input.saleDiscountCents,
      saleDiscountReason: input.saleDiscountReason,
    },
    catalog(sticker, print)
  );

  assert.equal(result.totalCents, expected.totalCents);
  const [header, ...lines] = statements;
  assert.deepEqual(header.params.slice(0, 6), [
    result.saleId,
    "tenant-1",
    "user-1",
    "cash",
    expected.saleDiscountCents,
    "redondeo",
  ]);
  assert.deepEqual(
    lines.map(({ params }) => ({
      productId: params[3],
      productName: params[4],
      category: params[5],
      quantity: params[6],
      unitPriceCents: params[7],
      unitCostCents: params[8],
      lineDiscountCents: params[9],
      lineDiscountReason: params[10],
      lineTotalCents: params[11],
    })),
    expected.lines
  );
});

test("a NaN discount never reaches the upload queue", async () => {
  const { db, statements } = recordingDb();

  await assert.rejects(
    createSaleLocal(db, {
      tenantId: "tenant-1",
      userId: "user-1",
      paymentMethod: "cash",
      saleDiscountCents: Number.NaN,
      lines: [{ product: sticker, quantity: 1 }],
    }),
    /descuentos/
  );
  assert.equal(statements.length, 0);
});
