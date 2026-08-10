import assert from "node:assert/strict";
import test from "node:test";
import {
  canRefundSale,
  canVoidSale,
  saleStatusLabel,
} from "@/components/screens/sale-detail-screen.helpers";
import type { Sale } from "@/lib/types";

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "sale-1",
    tenantId: "tenant-1",
    userId: "user-1",
    userName: "Vendedora",
    createdAt: "2026-08-09T12:00:00.000Z",
    paymentMethod: "cash",
    saleDiscountCents: 0,
    lines: [],
    status: "completed",
    ...overrides,
  };
}

test("void window includes exactly ten minutes and excludes the next millisecond", () => {
  const original = sale();
  const createdAt = new Date(original.createdAt).getTime();

  assert.equal(canVoidSale(original, [original], createdAt + 600_000), true);
  assert.equal(canVoidSale(original, [original], createdAt + 600_001), false);
});

test("void allows small clock skew but rejects clearly future createdAt", () => {
  const original = sale();
  const createdAt = new Date(original.createdAt).getTime();

  assert.equal(canVoidSale(original, [original], createdAt - 5_000), true);
  assert.equal(canVoidSale(original, [original], createdAt - 5_001), false);
});

test("refunds block both corrective actions on the original sale", () => {
  const original = sale();
  const refund = sale({
    id: "refund-1",
    createdAt: "2026-08-09T13:00:00.000Z",
    status: "refunded",
    refundOfSaleId: original.id,
  });

  assert.equal(canVoidSale(original, [original, refund]), false);
  assert.equal(canRefundSale(original, [original, refund]), false);
  assert.equal(saleStatusLabel(original, [original, refund]), "Reembolsada");
});

test("voided sales cannot be refunded", () => {
  const voided = sale({
    status: "voided",
    voidedAt: "2026-08-09T12:01:00.000Z",
    voidedByUserId: "user-1",
  });

  assert.equal(canVoidSale(voided, [voided]), false);
  assert.equal(canRefundSale(voided, [voided]), false);
});
