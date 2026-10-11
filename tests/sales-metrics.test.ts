import assert from "node:assert/strict";
import test from "node:test";
import { groupSalesByDay } from "@/components/screens/sales-screen.helpers";
import {
  allocateProportionally,
  computeCategoryTotals,
  computeMetrics,
  computePaymentTotals,
  computeProductTotals,
  computeSellerTotal,
  computeUserTotals,
  creditedSellerName,
  salesCreditedTo,
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
// A refund repeats the original's lines and payment method. Ana records the
// refund of Bea's sale.
const refund: Sale = {
  ...qr,
  id: "r1",
  userId: "ana",
  userName: "Ana",
  status: "refunded",
  refundOfSaleId: "s2",
  refundOfSaleUserId: "bea",
  refundOfSaleUserName: "Bea",
};
const sales = [mixed, qr, voided, refund];

/** A seller's paymentTotals, Efectivo then QR. */
function byMethod(cash: number, qrTransfer: number) {
  return [
    { paymentMethod: "cash", label: "Efectivo", total: cash },
    { paymentMethod: "qr_transfer", label: "QR", total: qrTransfer },
  ];
}

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
  // The refund Ana recorded nets against Bea, who made the sale, and
  // against QR, the method Bea's sale was paid with.
  assert.deepEqual(computeUserTotals(sales), [
    {
      userId: "ana",
      userName: "Ana",
      transactionCount: 1,
      total: 4000,
      paymentTotals: byMethod(4000, 0),
    },
    {
      userId: "bea",
      userName: "Bea",
      transactionCount: 1,
      total: 0,
      paymentTotals: byMethod(0, 0),
    },
  ]);
});

test("the seller breakdown nets a refund against whoever made the sale", () => {
  // Bea's sale from before the set, refunded by Ana within it.
  const earlierRefund: Sale = {
    ...refund,
    id: "r-early",
    refundOfSaleId: "earlier",
  };
  assert.deepEqual(computeUserTotals([mixed, earlierRefund]), [
    {
      userId: "ana",
      userName: "Ana",
      transactionCount: 1,
      total: 4000,
      paymentTotals: byMethod(4000, 0),
    },
    {
      userId: "bea",
      userName: "Bea",
      transactionCount: 0,
      total: -1000,
      paymentTotals: byMethod(0, -1000),
    },
  ]);

  // A refund record that does not name the seller counts for whoever
  // recorded it.
  const unattributed: Sale = {
    ...earlierRefund,
    refundOfSaleUserId: undefined,
    refundOfSaleUserName: undefined,
  };
  assert.deepEqual(computeUserTotals([unattributed]), [
    {
      userId: "ana",
      userName: "Ana",
      transactionCount: 0,
      total: -1000,
      paymentTotals: byMethod(0, -1000),
    },
  ]);
});

test("the seller breakdown splits each seller's net by payment method", () => {
  const anaQr = sale({
    id: "s5",
    paymentMethod: "qr_transfer",
    lines: [line("print", 1, 2500, null)],
  });
  // Ana took both methods; Bea's QR sale and its refund cancel out on QR.
  assert.deepEqual(computeUserTotals([mixed, anaQr, qr, voided, refund]), [
    {
      userId: "ana",
      userName: "Ana",
      transactionCount: 2,
      total: 6500,
      paymentTotals: byMethod(4000, 2500),
    },
    {
      userId: "bea",
      userName: "Bea",
      transactionCount: 1,
      total: 0,
      paymentTotals: byMethod(0, 0),
    },
  ]);
  // A voided sale takes nothing, not even a 0 Bs row of its own.
  assert.deepEqual(computeUserTotals([voided]), []);
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

/**
 * 60 sales by three sellers, with voids, refunds recorded by any seller and
 * the refund of a sale from outside the set.
 */
function generateLedger(): Sale[] {
  // A small deterministic generator, so the case is the same on every run.
  // Park–Miller: seed × 48 271 stays below 2^53, so the arithmetic is exact.
  let seed = 7;
  const next = (max: number) => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed % max;
  };
  const sellers = ["ana", "bea", "ceci"];
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
    const seller = sellers[next(3)];
    const original = sale({
      id: `g${index}`,
      userId: seller,
      userName: seller,
      paymentMethod: next(2) ? "cash" : "qr_transfer",
      saleDiscountCents: next(subtotal + 1),
      status: next(10) === 0 ? "voided" : "completed",
      lines,
    });
    generated.push(original);
    if (original.status === "completed" && next(4) === 0) {
      // Recorded by any seller, as the loaders build it: naming the seller.
      const recorder = sellers[next(3)];
      generated.push({
        ...original,
        id: `r${index}`,
        userId: recorder,
        userName: recorder,
        status: "refunded",
        refundOfSaleId: original.id,
        refundOfSaleUserId: original.userId,
        refundOfSaleUserName: original.userName,
      });
    }
  }
  // A refund whose sale is outside the set.
  generated.push({ ...qr, id: "r-early", refundOfSaleId: "earlier" });
  return generated;
}

test("category, product and payment breakdowns add up to the net revenue", () => {
  const generated = generateLedger();

  // The set holds what the checks below need.
  assert.deepEqual(
    new Set(generated.map((item) => item.paymentMethod)),
    new Set(["cash", "qr_transfer"])
  );
  assert.ok(generated.some((item) => item.status === "voided"));
  assert.ok(
    generated.some(
      (item) =>
        item.refundOfSaleUserId && item.refundOfSaleUserId !== item.userId
    )
  );

  const { netRevenueCents } = computeMetrics(generated);
  assert.notEqual(netRevenueCents, 0);
  const sum = (items: { total: number }[]) =>
    items.reduce((total, item) => total + item.total, 0);
  assert.equal(sum(computeCategoryTotals(generated)), netRevenueCents);
  assert.equal(sum(computeProductTotals(generated)), netRevenueCents);
  assert.equal(sum(computePaymentTotals(generated)), netRevenueCents);
  const userTotals = computeUserTotals(generated);
  assert.equal(sum(userTotals), netRevenueCents);

  // Each seller's split adds up to their net, and each method's amounts
  // across sellers add up to that method in the payment breakdown.
  for (const user of userTotals) {
    assert.equal(sum(user.paymentTotals), user.total);
  }
  const paymentTotals = computePaymentTotals(generated);
  for (const label of ["Efectivo", "QR"]) {
    assert.equal(
      sum(
        userTotals.flatMap((user) =>
          user.paymentTotals.filter((payment) => payment.label === label)
        )
      ),
      paymentTotals.find((payment) => payment.label === label)?.total ?? 0
    );
  }
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

test("a seller's records are their sales, voided ones too, and the refunds of their sales whoever recorded them", () => {
  // r1 is Ana's refund of Bea's sale: it is Bea's, not Ana's.
  assert.deepEqual(salesCreditedTo(sales, "ana"), [mixed, voided]);
  assert.deepEqual(salesCreditedTo(sales, "bea"), [qr, refund]);
  // A refund record that names no seller is its recorder's.
  const unattributed: Sale = {
    ...refund,
    id: "r-loose",
    refundOfSaleUserId: undefined,
    refundOfSaleUserName: undefined,
  };
  assert.deepEqual(salesCreditedTo([unattributed], "ana"), [unattributed]);
  assert.deepEqual(salesCreditedTo(sales, "nadie"), []);
});

test("a seller's total is their Por vendedor row, from their records alone", () => {
  const generated = generateLedger();
  const rows = computeUserTotals(generated);
  assert.ok(rows.length > 1);

  for (const row of rows) {
    const own = salesCreditedTo(generated, row.userId);
    assert.deepEqual(computeSellerTotal(generated, row.userId, "?"), row);
    assert.deepEqual(computeSellerTotal(own, row.userId, "?"), row);
    assert.deepEqual(computeUserTotals(own), [row]);
    // The seller's list: its net and sales count, and its days' nets.
    const metrics = computeMetrics(own);
    assert.equal(metrics.netRevenueCents, row.total);
    assert.equal(metrics.transactionCount, row.transactionCount);
    assert.equal(
      groupSalesByDay(own).reduce((sum, day) => sum + day.netCents, 0),
      row.total
    );
  }

  // Every record is on exactly one seller's list.
  const credited = new Set(
    generated.map((item) => item.refundOfSaleUserId ?? item.userId)
  );
  assert.equal(
    [...credited].reduce(
      (count, userId) => count + salesCreditedTo(generated, userId).length,
      0
    ),
    generated.length
  );

  // The ledger holds the cases the checks are about.
  const ids = new Set(generated.map((item) => item.id));
  assert.ok(generated.some((item) => item.status === "voided"));
  assert.ok(
    generated.some(
      (item) =>
        item.refundOfSaleUserId && item.refundOfSaleUserId !== item.userId
    )
  );
  assert.ok(
    generated.some(
      (item) => item.refundOfSaleId && !ids.has(item.refundOfSaleId)
    )
  );
});

test("a seller with nothing that counts has a zero total", () => {
  assert.deepEqual(computeSellerTotal([], "x", "Xime"), {
    userId: "x",
    userName: "Xime",
    transactionCount: 0,
    total: 0,
    paymentTotals: byMethod(0, 0),
  });
  assert.deepEqual(computeSellerTotal([voided], "ana", "Ana"), {
    userId: "ana",
    userName: "Ana",
    transactionCount: 0,
    total: 0,
    paymentTotals: byMethod(0, 0),
  });
});

test("a refund of an earlier sale lists alone and makes its seller's total negative", () => {
  const earlierRefund: Sale = {
    ...refund,
    id: "r-early",
    refundOfSaleId: "earlier",
  };
  const own = salesCreditedTo([mixed, earlierRefund], "bea");
  assert.deepEqual(own, [earlierRefund]);
  assert.deepEqual(computeSellerTotal(own, "bea", "Bea"), {
    userId: "bea",
    userName: "Bea",
    transactionCount: 0,
    total: -1000,
    paymentTotals: byMethod(0, -1000),
  });
});

test("a seller's name comes from their newest loaded record", () => {
  const older = sale({
    id: "b-old",
    userId: "bea",
    userName: "Bea",
    createdAt: "2026-09-01T10:00:00.000Z",
    lines: [line("sticker", 1, 1000, 300)],
  });
  // Ana refunds it later, when the puesto knows Bea as Beatriz.
  const newer: Sale = {
    ...older,
    id: "r-new",
    userId: "ana",
    userName: "Ana",
    createdAt: "2026-09-05T10:00:00.000Z",
    status: "refunded",
    refundOfSaleId: "b-old",
    refundOfSaleUserId: "bea",
    refundOfSaleUserName: "Beatriz",
  };

  assert.equal(creditedSellerName([older, newer], "bea"), "Beatriz");
  assert.equal(creditedSellerName([newer, older], "bea"), "Beatriz");
  // Ana only recorded Bea's refund.
  assert.equal(creditedSellerName([older, newer], "ana"), null);
  assert.equal(creditedSellerName([voided], "ana"), "Ana");
  assert.equal(creditedSellerName([older], "nadie"), null);
});
