import assert from "node:assert/strict";
import test from "node:test";
import { resolveSalesRange } from "@/lib/dates";
import {
  buildTrendBuckets,
  comparisonWindow,
  percentChange,
} from "@/lib/reports";
import type { Sale } from "@/lib/types";

function sale(id: string, createdAt: string, cents: number): Sale {
  return {
    id,
    tenantId: "t",
    userId: "u",
    userName: "Vendedora",
    createdAt,
    paymentMethod: "cash",
    saleDiscountCents: 0,
    status: "completed",
    lines: [
      {
        id: `${id}-line`,
        productId: "p",
        productName: "Producto",
        category: "Prints",
        quantity: 1,
        unitPriceCents: cents,
        unitCostCents: null,
        lineDiscountCents: 0,
        lineTotalCents: cents,
      },
    ],
  };
}

test("today compares with yesterday up to the same time", () => {
  const now = new Date("2026-09-26T18:30:00.000Z"); // 14:30 in La Paz
  const { bounds } = resolveSalesRange("today", "", "", now);
  assert.ok(bounds);
  const window = comparisonWindow("today", bounds!, now.getTime());

  assert.equal(window.label, "vs. ayer");
  assert.equal(window.bounds.start, Date.parse("2026-09-25T00:00:00-04:00"));
  assert.equal(window.bounds.end, Date.parse("2026-09-25T14:30:00-04:00"));
});

test("custom ranges compare with the equally long window before", () => {
  const { bounds } = resolveSalesRange("custom", "2026-09-10", "2026-09-12");
  const window = comparisonWindow(
    "custom",
    bounds!,
    Date.parse("2026-09-26T12:00:00Z")
  );

  assert.equal(window.label, "vs. período anterior");
  assert.equal(window.bounds.start, Date.parse("2026-09-07T00:00:00-04:00"));
  assert.equal(window.bounds.end, Date.parse("2026-09-10T00:00:00-04:00"));
});

test("percent change is null without a baseline", () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(100, 0), null);
});

test("single-day trends bucket by Bolivia hour within business hours", () => {
  const now = new Date("2026-09-26T23:00:00.000Z"); // 19:00 in La Paz
  const { bounds } = resolveSalesRange("today", "", "", now);
  const buckets = buildTrendBuckets(
    [
      sale("a", "2026-09-26T14:10:00.000Z", 3000), // 10:10
      sale("b", "2026-09-26T14:50:00.000Z", 2000), // 10:50
      sale("c", "2026-09-26T21:05:00.000Z", 1500), // 17:05
    ],
    bounds!,
    now.getTime()
  );

  assert.equal(buckets[0].label, "8 h");
  assert.equal(buckets.at(-1)?.label, "20 h");
  assert.equal(buckets.find((b) => b.key === "10")?.netCents, 5000);
  assert.equal(buckets.find((b) => b.key === "10")?.count, 2);
  assert.equal(buckets.find((b) => b.key === "17")?.netCents, 1500);
});

test("multi-day trends stop at today", () => {
  const now = new Date("2026-09-03T15:00:00.000Z");
  const { bounds } = resolveSalesRange("month", "", "", now);
  const buckets = buildTrendBuckets(
    [sale("a", "2026-09-02T15:00:00.000Z", 4000)],
    bounds!,
    now.getTime()
  );

  assert.equal(buckets.length, 3);
  assert.deepEqual(
    buckets.map((bucket) => bucket.netCents),
    [0, 4000, 0]
  );
});
