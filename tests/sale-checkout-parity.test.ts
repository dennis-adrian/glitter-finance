// Both checkout paths must record the same sale for the same cart: the
// PowerSync writer (lib/powersync/write-sales.ts) and the server action's
// repository (lib/sales/repository.ts). The repository runs against an
// in-memory stand-in for Drizzle, installed through the global lib/db reuses
// across hot reloads. The stand-in ignores WHERE clauses: each test starts
// from empty sale tables. The last tests cover loading the sales back.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import {
  products,
  refunds,
  saleLines,
  sales,
  tenantUsers,
} from "@/lib/db/schema";
import { buildSalesFromLocal } from "@/lib/powersync/sales-from-local";
import { createSaleLocal } from "@/lib/powersync/write-sales";
import { mapDbProductToProduct } from "@/lib/product-mapper";
import { computeCategoryTotals } from "@/lib/sales";
import type { Product } from "@/lib/types";

type Row = Record<string, unknown>;
type Call = { method: string; args: unknown[] };

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-000000000003";

function productRow(
  id: string,
  priceCents: number,
  category: string,
  costCents: number | null
) {
  const createdAt = new Date("2026-09-01T10:00:00.000Z");
  return {
    id,
    tenantId: TENANT_ID,
    name: `Producto ${id.slice(-1)}`,
    priceCents,
    costCents,
    category,
    imagePath: null,
    tracksInventory: false,
    lowStockThreshold: null,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

const productRows = [
  productRow("00000000-0000-4000-8000-00000000000a", 1500, "Stickers", 400),
  // A category saved before the rename; both paths record "Prints".
  productRow("00000000-0000-4000-8000-00000000000b", 4000, "Láminas", null),
];

/** The Drizzle calls the repository makes, answered from `tables`. */
function fakeDb() {
  const tables = new Map<unknown, Row[]>([
    [products, productRows],
    [sales, []],
    [saleLines, []],
    [refunds, []],
    [tenantUsers, []],
  ]);

  function query(run: (calls: Call[]) => unknown) {
    const calls: Call[] = [];
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (
              resolve: (value: unknown) => unknown,
              reject: (error: unknown) => unknown
            ) =>
              Promise.resolve()
                .then(() => run(calls))
                .then(resolve, reject);
          }
          return (...args: unknown[]) => {
            calls.push({ method: String(property), args });
            return builder;
          };
        },
      }
    );
    return builder;
  }

  const arg = (calls: Call[], method: string) =>
    calls.find((call) => call.method === method)?.args[0];

  const db = {
    select: () => query((calls) => [...(tables.get(arg(calls, "from")) ?? [])]),
    insert: (table: unknown) =>
      query((calls) => {
        const stored = tables.get(table)!;
        const skipConflicts = calls.some(
          (call) => call.method === "onConflictDoNothing"
        );
        const values = arg(calls, "values") as Row | Row[];
        const rows = (Array.isArray(values) ? values : [values])
          .map((row) => ({
            id: crypto.randomUUID(),
            voidedAt: null,
            voidedByUserId: null,
            ...row,
          }))
          .filter(
            (row) =>
              !skipConflicts ||
              !stored.some((existing) => existing.id === row.id)
          );
        stored.push(...rows);
        return rows;
      }),
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
  };

  function reset() {
    for (const table of [sales, saleLines, refunds, tenantUsers]) {
      tables.get(table)!.length = 0;
    }
  }

  return { db, tables, reset };
}

const fake = fakeDb();
beforeEach(() => fake.reset());

// lib/db reads its Drizzle instance from this global when one is set.
async function loadRepository() {
  Object.assign(globalThis, { glitterDb: fake.db, glitterPostgres: {} });
  process.env.DATABASE_URL ??= "postgres://localhost:5432/unused";
  return import("@/lib/sales/repository");
}

function recordingPowerSyncDb() {
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

const [sticker, print] = productRows.map(
  (row) => mapDbProductToProduct(row) as Product
);
const cart = [
  {
    product: sticker,
    quantity: 3,
    lineDiscountCents: 700,
    lineDiscountReason: " dañado ",
  },
  { product: print, quantity: 2, lineDiscountCents: 99_999 },
];
const checkout = {
  paymentMethod: "qr_transfer" as const,
  saleDiscountCents: 1_000_000,
  saleDiscountReason: "cierre",
  lines: cart.map((line) => ({
    productId: line.product.id,
    quantity: line.quantity,
    lineDiscountCents: line.lineDiscountCents,
    lineDiscountReason: line.lineDiscountReason,
  })),
};

function serverSale(saleId: string, tenantId = TENANT_ID) {
  return {
    ...checkout,
    saleId,
    tenantId,
    userId: USER_ID,
    userName: "Vendedora",
  };
}

test("the server action and the PowerSync writer record the same sale", async () => {
  const { createSaleForTenant } = await loadRepository();

  const local = recordingPowerSyncDb();
  await createSaleLocal(local.db, {
    tenantId: TENANT_ID,
    userId: USER_ID,
    paymentMethod: checkout.paymentMethod,
    saleDiscountCents: checkout.saleDiscountCents,
    saleDiscountReason: checkout.saleDiscountReason,
    lines: cart,
  });
  const [localHeader, ...localLines] = local.statements;

  const recorded = await createSaleForTenant(serverSale(crypto.randomUUID()));
  const [serverHeader] = fake.tables.get(sales)!;
  const serverLines = fake.tables.get(saleLines)!;

  assert.deepEqual(
    [serverHeader.saleDiscountCents, serverHeader.saleDiscountReason],
    localHeader.params.slice(4, 6)
  );
  assert.deepEqual(
    serverLines.map((line) => [
      line.productId,
      line.productName,
      line.category,
      line.quantity,
      line.unitPriceCents,
      line.unitCostCents,
      line.lineDiscountCents,
      line.lineDiscountReason,
      line.lineTotalCents,
    ]),
    localLines.map(({ params }) => params.slice(3, 12))
  );
  assert.deepEqual(
    serverLines.map((line) => [line.category, line.lineTotalCents]),
    [
      ["Stickers", 3800],
      ["Prints", 0],
    ]
  );
  assert.equal(recorded.saleDiscountCents, 3800);
});

test("retrying a recorded checkout returns the sale instead of a duplicate", async () => {
  const { createSaleForTenant } = await loadRepository();
  const saleId = crypto.randomUUID();

  const first = await createSaleForTenant(serverSale(saleId));
  const retry = await createSaleForTenant(serverSale(saleId));

  assert.equal(fake.tables.get(sales)!.length, 1);
  assert.equal(fake.tables.get(saleLines)!.length, 2);
  assert.equal(first.id, saleId);
  assert.equal(retry.id, saleId);
  assert.deepEqual(
    retry.lines.map((line) => line.lineTotalCents),
    first.lines.map((line) => line.lineTotalCents)
  );
});

test("a sale id already used in another tenant is never returned", async () => {
  const { createSaleForTenant } = await loadRepository();
  const saleId = crypto.randomUUID();
  await createSaleForTenant(serverSale(saleId));

  await assert.rejects(
    createSaleForTenant(serverSale(saleId, OTHER_TENANT_ID)),
    /id ya está en uso/
  );
  assert.equal(fake.tables.get(sales)!.length, 1);
});

test("legacy sale-line categories report under their current name", async () => {
  const { createSaleForTenant, getSalesForTenant } = await loadRepository();
  await createSaleForTenant(serverSale(crypto.randomUUID()));
  const [sale] = fake.tables.get(sales)!;
  fake.tables.get(saleLines)!.push({
    ...fake.tables.get(saleLines)![0],
    id: crypto.randomUUID(),
    category: "Pegatinas",
  });

  const serverSales = await getSalesForTenant(TENANT_ID);
  const localSales = buildSalesFromLocal(
    [
      {
        id: String(sale.id),
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        payment_method: "cash",
        sale_discount_cents: 0,
        sale_discount_reason: null,
        voided_at: null,
        voided_by_user_id: null,
        created_at: "2026-09-02T10:00:00.000Z",
        client_created_at: "2026-09-02T10:00:00.000Z",
      },
    ],
    fake.tables.get(saleLines)!.map((line) => ({
      id: String(line.id),
      sale_id: String(line.saleId),
      tenant_id: TENANT_ID,
      product_id: String(line.productId),
      product_name: String(line.productName),
      category: String(line.category),
      quantity: Number(line.quantity),
      unit_price_cents: Number(line.unitPriceCents),
      unit_cost_cents: line.unitCostCents as number | null,
      line_discount_cents: Number(line.lineDiscountCents),
      line_discount_reason: line.lineDiscountReason as string | null,
      line_total_cents: Number(line.lineTotalCents),
      created_at: "2026-09-02T10:00:00.000Z",
    })),
    [],
    () => "Vendedora"
  );

  for (const loaded of [serverSales, localSales]) {
    assert.deepEqual(
      loaded[0].lines.map((line) => line.category),
      ["Stickers", "Prints", "Stickers"]
    );
    assert.deepEqual(
      computeCategoryTotals(loaded).map((item) => item.category),
      ["Stickers"]
    );
  }
});

test("loaded sales take seller names from the members they are given", async () => {
  const { createSaleForTenant, getSalesForTenant } = await loadRepository();
  const saleId = crypto.randomUUID();
  await createSaleForTenant(serverSale(saleId));
  const refundUserId = "00000000-0000-4000-8000-000000000004";
  const refundedAt = new Date(Date.now() + 60_000);
  fake.tables.get(refunds)!.push({
    id: crypto.randomUUID(),
    tenantId: TENANT_ID,
    originalSaleId: saleId,
    userId: refundUserId,
    reason: null,
    createdAt: refundedAt,
    clientCreatedAt: refundedAt,
  });
  const members = [
    { id: "m1", userId: USER_ID, displayName: "Ana", createdAt: "" },
    { id: "m2", userId: refundUserId, displayName: "Beto", createdAt: "" },
  ];

  assert.deepEqual(
    (
      await getSalesForTenant(TENANT_ID, { members: Promise.resolve(members) })
    ).map((sale) => [sale.status, sale.userName, sale.lines.length]),
    [
      ["refunded", "Beto", 2],
      ["completed", "Ana", 2],
    ]
  );

  // Without members, the names are queried: none are stored here.
  const queried = await getSalesForTenant(TENANT_ID);
  assert.deepEqual(
    queried.map((sale) => sale.userName),
    ["Vendedor", "Vendedor"]
  );
});
