import assert from "node:assert/strict";
import test from "node:test";
import {
  firstSalesByDay,
  groupSalesByDay,
} from "@/components/screens/sales-screen.helpers";
import { filterSalesByBounds } from "@/lib/dates";
import { computeMetrics, indexSales, sortSalesNewestFirst } from "@/lib/sales";
import type { Sale } from "@/lib/types";

function sale(id: string, createdAt: string, cents = 1000): Sale {
  return {
    id,
    tenantId: "tenant-1",
    userId: "ana",
    userName: "Ana",
    createdAt,
    paymentMethod: "cash",
    saleDiscountCents: 0,
    status: "completed",
    lines: [
      {
        id: `${id}-line`,
        productId: "sticker",
        productName: "Sticker",
        category: "Stickers",
        quantity: 1,
        unitPriceCents: cents,
        unitCostCents: null,
        lineDiscountCents: 0,
        lineTotalCents: cents,
      },
    ],
  };
}

// 50 sales on 27 Sept (Bolivia) and 3 on 26 Sept, in no particular order.
const today = Array.from({ length: 50 }, (_, index) =>
  sale(
    `t${index}`,
    new Date(
      Date.parse("2026-09-27T12:00:00.000Z") + index * 60_000
    ).toISOString()
  )
);
// 01:00 UTC on the 27th is still the 26th in La Paz.
const yesterday = [
  sale("y0", "2026-09-27T01:00:00.000Z", 500),
  sale("y1", "2026-09-26T20:00:00.000Z", 500),
  sale("y2", "2026-09-26T15:00:00.000Z", 500),
];
const sales = [
  ...yesterday,
  ...today.slice().reverse().slice(10),
  ...today.slice(40),
];

test("sales sort newest first", () => {
  const sorted = sortSalesNewestFirst(sales);
  assert.equal(sorted[0].id, "t49");
  assert.equal(sorted.at(-1)?.id, "y2");
  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(
      Date.parse(sorted[index - 1].createdAt) >=
        Date.parse(sorted[index].createdAt)
    );
  }
});

test("a day's total covers all of its sales, not only the page shown", () => {
  const groups = groupSalesByDay(sales);
  assert.deepEqual(
    groups.map((group) => [group.key, group.sales.length, group.netCents]),
    [
      ["2026-09-27", 50, 50_000],
      ["2026-09-26", 3, 1_500],
    ]
  );

  const firstPage = firstSalesByDay(groups, 40);
  assert.equal(firstPage.length, 1);
  assert.equal(firstPage[0].sales.length, 40);
  assert.equal(firstPage[0].sales[0].id, "t49");
  // The day's total does not shrink to the 40 rows shown.
  assert.equal(firstPage[0].netCents, 50_000);
  assert.equal(
    firstPage[0].netCents,
    computeMetrics(
      filterSalesByBounds(sales, {
        start: Date.parse("2026-09-27T00:00:00-04:00"),
        end: Date.parse("2026-09-28T00:00:00-04:00"),
      })
    ).netRevenueCents
  );

  const secondPage = firstSalesByDay(groups, 80);
  assert.deepEqual(
    secondPage.map((group) => group.sales.length),
    [50, 3]
  );
  assert.equal(secondPage[0], groups[0]);
  assert.deepEqual(firstSalesByDay(groups, 0), []);
});

test("the sale index finds sales and their refunds", () => {
  const refund: Sale = {
    ...sale("r1", "2026-09-27T13:00:00.000Z"),
    status: "refunded",
    refundOfSaleId: "t1",
  };
  const index = indexSales([...sales, refund]);
  assert.equal(index.byId.get("t1")?.id, "t1");
  assert.equal(index.refundBySaleId.get("t1"), refund);
  assert.equal(index.refundBySaleId.has("t2"), false);
});
