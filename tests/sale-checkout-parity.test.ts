// Both checkout paths must record the same sale for the same cart: the
// PowerSync writer (lib/powersync/write-sales.ts) and the server action's
// repository (lib/sales/repository.ts). The repository runs against an
// in-memory stand-in for Drizzle, installed through the global lib/db reuses
// across hot reloads.

import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { products, saleLines, sales, tenantUsers } from "@/lib/db/schema";
import { createSaleLocal } from "@/lib/powersync/write-sales";
import { mapDbProductToProduct } from "@/lib/product-mapper";
import type { Product } from "@/lib/types";

type Row = Record<string, unknown>;
type Call = { method: string; args: unknown[] };

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

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
        const values = arg(calls, "values") as Row | Row[];
        const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
          id: crypto.randomUUID(),
          voidedAt: null,
          voidedByUserId: null,
          ...row,
        }));
        tables.get(table)!.push(...rows);
        return rows;
      }),
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
  };
  return { db, tables };
}

const fake = fakeDb();

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

test("the server action and the PowerSync writer record the same sale", async () => {
  const { createSaleForTenant } = await loadRepository();
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
  const sale = {
    paymentMethod: "qr_transfer" as const,
    saleDiscountCents: 1_000_000,
    saleDiscountReason: "cierre",
  };

  const local = recordingPowerSyncDb();
  await createSaleLocal(local.db, {
    tenantId: TENANT_ID,
    userId: USER_ID,
    ...sale,
    lines: cart,
  });
  const [localHeader, ...localLines] = local.statements;

  const recorded = await createSaleForTenant({
    tenantId: TENANT_ID,
    userId: USER_ID,
    userName: "Vendedora",
    ...sale,
    lines: cart.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      lineDiscountCents: line.lineDiscountCents,
      lineDiscountReason: line.lineDiscountReason,
    })),
  });
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
