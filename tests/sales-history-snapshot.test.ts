// getSalesForTenant (lib/sales/repository.ts) against a stand-in for Postgres
// that models what each read sees. A statement on its own pooled connection
// sees the rows committed when it starts, and a connection still being
// opened starts it late. Inside a repeatable-read transaction every
// statement sees the rows committed when the first one started. The
// stand-in ignores WHERE clauses: there is one tenant and no date filter
// excludes a row.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { isDeepStrictEqual } from "node:util";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { refunds, saleLines, sales } from "@/lib/db/schema";

type Row = Record<string, unknown>;
type Tables = Map<unknown, Row[]>;

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-00000000000a";
const members = [
  { id: "m1", userId: USER_ID, displayName: "Ana", createdAt: "" },
];

const committed: Tables = new Map<unknown, Row[]>([
  [sales, []],
  [saleLines, []],
  [refunds, []],
]);

/** Runs once, right after the next statement takes its snapshot. */
let afterNextSnapshot: (() => void) | undefined;
/** Tables whose next statement waits for a pooled connection to open. */
const slowConnections = new Set<unknown>();

function snapshotOf(state: Tables, table: unknown) {
  const rows = [...(state.get(table) ?? [])];
  const hook = afterNextSnapshot;
  afterNextSnapshot = undefined;
  hook?.();
  return rows;
}

function copyOfCommitted(): Tables {
  return new Map([...committed].map(([table, rows]) => [table, [...rows]]));
}

/** A query builder that ignores its clauses and runs `execute` when awaited. */
function query(execute: (table: unknown) => Promise<Row[]>) {
  let table: unknown;
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (error: unknown) => unknown
          ) => execute(table).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          if (property === "from") table = args[0];
          return builder;
        };
      },
    }
  );
  return builder;
}

const db = {
  select: () =>
    query(async (table) => {
      if (slowConnections.delete(table)) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return snapshotOf(committed, table);
    }),
  transaction: async <T>(
    run: (tx: unknown) => Promise<T>,
    config?: PgTransactionConfig
  ) => {
    // One connection: its statements run in the order they are sent.
    let previous: Promise<unknown> = Promise.resolve();
    let shared: Tables | undefined;
    const tx = {
      select: () =>
        query((table) => {
          const statement = previous.then(() =>
            snapshotOf(
              config?.isolationLevel === "repeatable read"
                ? (shared ??= copyOfCommitted())
                : copyOfCommitted(),
              table
            )
          );
          previous = statement.catch(() => undefined);
          return statement;
        }),
    };
    return run(tx);
  },
};

function commitSale(id: string, at: Date, lineCount: number) {
  committed.get(sales)!.push({
    id,
    tenantId: TENANT_ID,
    userId: USER_ID,
    paymentMethod: "cash",
    saleDiscountCents: 0,
    saleDiscountReason: null,
    voidedAt: null,
    voidedByUserId: null,
    createdAt: at,
    clientCreatedAt: at,
  });
  for (let index = 0; index < lineCount; index += 1) {
    committed.get(saleLines)!.push({
      id: crypto.randomUUID(),
      saleId: id,
      tenantId: TENANT_ID,
      productId: PRODUCT_ID,
      productName: "Sticker",
      category: "Stickers",
      quantity: 1,
      unitPriceCents: 1500,
      unitCostCents: null,
      lineDiscountCents: 0,
      lineDiscountReason: null,
      lineTotalCents: 1500,
      createdAt: at,
    });
  }
}

function commitRefund(originalSaleId: string, at: Date) {
  committed.get(refunds)!.push({
    id: crypto.randomUUID(),
    tenantId: TENANT_ID,
    originalSaleId,
    userId: USER_ID,
    reason: null,
    createdAt: at,
    clientCreatedAt: at,
  });
}

beforeEach(() => {
  for (const rows of committed.values()) rows.length = 0;
  afterNextSnapshot = undefined;
  slowConnections.clear();
});

// lib/db reads its Drizzle instance from this global when one is set.
async function loadRepository() {
  Object.assign(globalThis, { glitterDb: db, glitterPostgres: {} });
  process.env.DATABASE_URL ??= "postgres://localhost:5432/unused";
  return import("@/lib/sales/repository");
}

const earlierSaleId = "00000000-0000-4000-8000-0000000000b1";
const racingSaleId = "00000000-0000-4000-8000-0000000000b2";

for (const since of [undefined, new Date("2026-09-01T00:00:00.000Z")]) {
  test(`a checkout committing mid-load shows whole or not at all (${
    since ? "recent" : "full"
  } history)`, async () => {
    const { getSalesForTenant } = await loadRepository();
    const load = () => getSalesForTenant(TENANT_ID, { since, members });
    commitSale(earlierSaleId, new Date("2026-09-20T10:00:00.000Z"), 1);

    const before = await load();
    // Another device's checkout, and a refund of the earlier sale, commit
    // just after the load's first statement starts, while the connection
    // for the sales statement is still being opened.
    afterNextSnapshot = () => {
      const at = new Date("2026-09-20T11:00:00.000Z");
      commitSale(racingSaleId, at, 2);
      commitRefund(earlierSaleId, at);
    };
    slowConnections.add(sales);
    const raced = await load();
    const after = await load();

    assert.deepEqual(
      after.map((sale) => [sale.status, sale.lines.length]),
      [
        ["completed", 2],
        ["refunded", 1],
        ["completed", 1],
      ]
    );
    assert.ok(
      isDeepStrictEqual(raced, before) || isDeepStrictEqual(raced, after),
      `loaded a state that never existed: ${JSON.stringify(
        raced.map((sale) => [sale.id, sale.status, sale.lines.length])
      )}`
    );
  });
}
