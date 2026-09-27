import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCategoryTotals,
  computeMetrics,
  computePaymentTotals,
  computeProductTotals,
  computeUserTotals,
  saleHasUnknownCost,
  saleNetCents,
  saleProfitCents,
  saleTotal,
} from "@/lib/sales";
import type { Sale, SaleLine } from "@/lib/types";

function line(
  productId: string,
  quantity: number,
  unitPriceCents: number,
  unitCostCents: number | null,
  lineDiscountCents = 0
): SaleLine {
  return {
    id: `${productId}-${quantity}`,
    productId,
    productName: productId === "sticker" ? "Sticker" : "Print",
    category: productId === "sticker" ? "Stickers" : "Prints",
    quantity,
    unitPriceCents,
    unitCostCents,
    lineDiscountCents,
    lineTotalCents: unitPriceCents * quantity - lineDiscountCents,
  };
}

function sale(overrides: Partial<Sale> & Pick<Sale, "id" | "lines">): Sale {
  return {
    tenantId: "tenant-1",
    userId: "ana",
    userName: "Ana",
    createdAt: "2026-09-03T10:00:00.000Z",
    paymentMethod: "cash",
    saleDiscountCents: 0,
    status: "completed",
    ...overrides,
  };
}

// Gross 4500, line discount 200, sale discount 300, one line without cost.
const mixed = sale({
  id: "s1",
  saleDiscountCents: 300,
  lines: [line("sticker", 2, 1000, 300, 200), line("print", 1, 2500, null)],
});
const qr = sale({
  id: "s2",
  userId: "bea",
  userName: "Bea",
  paymentMethod: "qr_transfer",
  lines: [line("sticker", 1, 1000, 300)],
});
const voided = sale({
  id: "s3",
  status: "voided",
  lines: [line("sticker", 5, 1000, 300)],
});
// A refund repeats the original's lines and payment method.
const refund: Sale = {
  ...qr,
  id: "r1",
  userId: "ana",
  userName: "Ana",
  status: "refunded",
  refundOfSaleId: "s2",
};
const sales = [mixed, qr, voided, refund];

test("a sale's net and profit take both discounts and the known costs", () => {
  assert.equal(saleNetCents(mixed), 4000);
  assert.equal(saleProfitCents(mixed), 3400);
  assert.equal(saleHasUnknownCost(mixed), true);
  assert.equal(saleHasUnknownCost(qr), false);
  assert.equal(saleTotal(mixed), "40 Bs");
});

test("a refund counts negative, and a sale discount never takes net below zero", () => {
  assert.equal(saleNetCents(refund), -1000);
  assert.equal(saleProfitCents(refund), -700);

  const overDiscounted = sale({
    id: "s4",
    saleDiscountCents: 900,
    lines: [line("sticker", 1, 500, 100)],
  });
  assert.equal(saleNetCents(overDiscounted), 0);
  assert.equal(saleProfitCents(overDiscounted), -100);
});

test("metrics exclude voids and subtract refunds", () => {
  assert.deepEqual(computeMetrics(sales), {
    grossCents: 4500,
    discountCents: 500,
    netRevenueCents: 4000,
    costCents: 600,
    netEarningsCents: 3400,
    transactionCount: 2,
    refundCount: 1,
    hasUnknownCost: true,
  });
  assert.deepEqual(computeMetrics([]), {
    grossCents: 0,
    discountCents: 0,
    netRevenueCents: 0,
    costCents: 0,
    netEarningsCents: 0,
    transactionCount: 0,
    refundCount: 0,
    hasUnknownCost: false,
  });
});

test("report breakdowns net refunds against their sales", () => {
  assert.deepEqual(computePaymentTotals(sales), [
    { label: "Efectivo", total: 4000 },
  ]);
  assert.deepEqual(computeCategoryTotals(sales), [
    { category: "Prints", total: 2500 },
    { category: "Stickers", total: 1800 },
  ]);
  assert.deepEqual(computeProductTotals(sales), [
    { productId: "sticker", productName: "Sticker", quantity: 2, total: 1800 },
    { productId: "print", productName: "Print", quantity: 1, total: 2500 },
  ]);
  assert.deepEqual(computeUserTotals(sales), [
    { userId: "ana", userName: "Ana", transactionCount: 1, total: 3000 },
    { userId: "bea", userName: "Bea", transactionCount: 1, total: 1000 },
  ]);
});
