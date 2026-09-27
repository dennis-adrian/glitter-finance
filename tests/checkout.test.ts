import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCashTender,
  suggestCashAmounts,
} from "@/components/screens/checkout-screen.helpers";
import { buildReceiptText, type CompletedSaleSummary } from "@/lib/receipt";

test("cash suggestions round the total up to common bills", () => {
  assert.deepEqual(suggestCashAmounts(3500), [4000, 5000, 10000]);
  assert.deepEqual(suggestCashAmounts(26500), [28000, 30000, 40000]);
  // Already a round amount: only larger bills make sense.
  assert.deepEqual(suggestCashAmounts(10000), [20000]);
  assert.deepEqual(suggestCashAmounts(0), []);
});

test("cash tender reports exact, short, and change states", () => {
  assert.deepEqual(evaluateCashTender(26000, null), { state: "exact" });
  assert.deepEqual(evaluateCashTender(26000, 26000), { state: "exact" });
  assert.deepEqual(evaluateCashTender(26000, 20000), {
    state: "short",
    missingCents: 6000,
  });
  assert.deepEqual(evaluateCashTender(26000, 30000), {
    state: "change",
    changeCents: 4000,
  });
});

test("receipt lists lines, discount, payment, and change", () => {
  const sale: CompletedSaleSummary = {
    saleId: "sale-1",
    createdAt: "2026-09-26T18:05:00.000Z",
    paymentMethod: "cash",
    lines: [
      { name: "Bolsa de feria", quantity: 1, totalCents: 12000 },
      { name: "Sticker", quantity: 4, totalCents: 14000 },
    ],
    itemCount: 5,
    subtotalCents: 26000,
    discountCents: 1000,
    totalCents: 25000,
    receivedCents: 30000,
    changeCents: 5000,
  };

  const text = buildReceiptText(sale, "Puesto Central");

  assert.match(text, /^Puesto Central · Billetera Ferial\n/);
  assert.match(text, /1× Bolsa de feria — 120 Bs/);
  assert.match(text, /4× Sticker — 140 Bs/);
  assert.match(text, /Descuento: −10 Bs/);
  assert.match(text, /Total: 250 Bs/);
  assert.match(text, /Pago: Efectivo/);
  assert.match(text, /Cambio: 50 Bs/);
});
