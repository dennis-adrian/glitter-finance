import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateProportionally,
  computeCategoryTotals,
  computeMetrics,
  computePaymentTotals,
  computeProductTotals,
  computeUserTotals,
  saleHasUnknownCost,
  saleLineNetCents,
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
    refundedCents: 1000,
    // s2 was refunded in the same set, so only s1 stood.
    averageTicketCents: 4000,
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
    refundedCents: 0,
    averageTicketCents: 0,
    hasUnknownCost: false,
  });
});

test("report breakdowns net refunds against their sales", () => {
  assert.deepEqual(computePaymentTotals(sales), [
    { label: "Efectivo", total: 4000 },
  ]);
  // s1's 3 Bs sale discount splits 1,26 / 1,74 between its 18 Bs and 25 Bs
  // lines.
  assert.deepEqual(computeCategoryTotals(sales), [
    { category: "Prints", total: 2326 },
    { category: "Stickers", total: 1674 },
  ]);
  assert.deepEqual(computeProductTotals(sales), [
    { productId: "sticker", productName: "Sticker", quantity: 2, total: 1674 },
    { productId: "print", productName: "Print", quantity: 1, total: 2326 },
  ]);
  assert.deepEqual(computeUserTotals(sales), [
    { userId: "ana", userName: "Ana", transactionCount: 1, total: 3000 },
    { userId: "bea", userName: "Bea", transactionCount: 1, total: 1000 },
  ]);
});

test("a proportional split adds up exactly, extra cents to the largest remainders", () => {
  assert.deepEqual(allocateProportionally(300, [1800, 2500]), [126, 174]);
  assert.deepEqual(allocateProportionally(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocateProportionally(2, [0, 5, 5]), [0, 1, 1]);
  assert.deepEqual(allocateProportionally(0, [5, 5]), [0, 0]);
  assert.deepEqual(allocateProportionally(7, [0, 0]), [0, 0]);
  assert.deepEqual(allocateProportionally(7, []), []);
  // amount × weight is past 2^53 here, where float division would drift.
  const big = allocateProportionally(
    2_000_000_001,
    [2_147_483_647, 1_000_000_007]
  );
  assert.equal(big[0] + big[1], 2_000_000_001);
  assert.deepEqual(big, [1_364_571_756, 635_428_245]);
});

test("a sale's lines share its sale discount and add up to its net", () => {
  const discounted = sale({
    id: "d1",
    saleDiscountCents: 100,
    lines: [
      line("sticker", 1, 1000, null),
      line("print", 1, 1000, null),
      line("mug", 1, 1000, null),
    ],
  });
  assert.deepEqual(saleLineNetCents(discounted), [966, 967, 967]);
  assert.deepEqual(
    saleLineNetCents({ ...discounted, refundOfSaleId: "x" }),
    [-966, -967, -967]
  );
  // Never more discount than the lines hold.
  const overDiscounted = { ...discounted, saleDiscountCents: 5000 };
  assert.deepEqual(saleLineNetCents(overDiscounted), [0, 0, 0]);
  assert.equal(saleNetCents(overDiscounted), 0);
});

test("category, product and payment breakdowns add up to the net revenue", () => {
  // A small deterministic generator, so the case is the same on every run.
  let seed = 7;
  const next = (max: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % max;
  };
  const productIds = ["sticker", "print", "mug", "pin"];
  const generated: Sale[] = [];
  for (let index = 0; index < 60; index += 1) {
    const lines = productIds
      .filter(() => next(2) === 1)
      .map((productId) => {
        const quantity = 1 + next(4);
        const unitPriceCents = 100 + next(5000);
        return line(
          productId,
          quantity,
          unitPriceCents,
          null,
          next(unitPriceCents * quantity)
        );
      });
    if (!lines.length) continue;
    const subtotal = lines.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const original = sale({
      id: `g${index}`,
      paymentMethod: next(2) ? "cash" : "qr_transfer",
      saleDiscountCents: next(subtotal + 1),
      status: next(10) === 0 ? "voided" : "completed",
      lines,
    });
    generated.push(original);
    if (original.status === "completed" && next(4) === 0) {
      generated.push({
        ...original,
        id: `r${index}`,
        status: "refunded",
        refundOfSaleId: original.id,
      });
    }
  }
  // A refund whose sale is outside the set.
  generated.push({ ...qr, id: "r-early", refundOfSaleId: "earlier" });

  const { netRevenueCents } = computeMetrics(generated);
  const sum = (items: { total: number }[]) =>
    items.reduce((total, item) => total + item.total, 0);
  assert.equal(sum(computeCategoryTotals(generated)), netRevenueCents);
  assert.equal(sum(computeProductTotals(generated)), netRevenueCents);
  assert.equal(sum(computePaymentTotals(generated)), netRevenueCents);
  assert.equal(sum(computeUserTotals(generated)), netRevenueCents);
});

test("a range with only the refund of an earlier sale shows negative rows", () => {
  const earlierRefund: Sale = {
    ...qr,
    id: "r-early",
    status: "refunded",
    refundOfSaleId: "earlier",
  };

  assert.deepEqual(computeCategoryTotals([earlierRefund]), [
    { category: "Stickers", total: -1000 },
  ]);
  assert.deepEqual(computeProductTotals([earlierRefund]), [
    {
      productId: "sticker",
      productName: "Sticker",
      quantity: -1,
      total: -1000,
    },
  ]);
});

test("the average ticket ignores refunds of earlier sales and refunded sales", () => {
  const fifteen = sale({ id: "a", lines: [line("print", 1, 1500, null)] });
  const twenty = sale({ id: "b", lines: [line("print", 1, 2000, null)] });
  const earlierRefund: Sale = {
    ...fifteen,
    id: "r-early",
    status: "refunded",
    refundOfSaleId: "earlier",
  };

  // 15 + 20 − 15 net over two sales would say 10 Bs.
  const withEarlierRefund = computeMetrics([fifteen, twenty, earlierRefund]);
  assert.equal(withEarlierRefund.netRevenueCents, 2000);
  assert.equal(withEarlierRefund.averageTicketCents, 1750);
  assert.equal(withEarlierRefund.refundCount, 1);
  assert.equal(withEarlierRefund.refundedCents, 1500);

  // A sale refunded in the same range drops out of the ticket entirely.
  const refundedTwenty: Sale = {
    ...twenty,
    id: "r-b",
    status: "refunded",
    refundOfSaleId: "b",
  };
  const withRefundedSale = computeMetrics([fifteen, twenty, refundedTwenty]);
  assert.equal(withRefundedSale.transactionCount, 2);
  assert.equal(withRefundedSale.averageTicketCents, 1500);

  // Only refunds: no sale stood, so no ticket.
  assert.equal(computeMetrics([earlierRefund]).averageTicketCents, 0);
});
