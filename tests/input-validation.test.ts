import assert from "node:assert/strict";
import test from "node:test";
import { UserFacingError } from "@/lib/action-result";
import { isPaymentMethod } from "@/lib/sales";
import { parseCheckoutRequest } from "@/lib/sales/checkout-request";
import { MAX_SALE_LINES } from "@/lib/sales/pricing";
import {
  characterCount,
  isUuid,
  MAX_NOTE_LENGTH,
  normalizeNote,
  requireUuid,
} from "@/lib/validation";

const PRODUCT_ID = "0F6B1C2A-9D3E-4F5A-8B7C-6D5E4F3A2B1C";

function refused(run: () => unknown, message: RegExp) {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof UserFacingError && message.test(error.message)
  );
}

test("ids must be UUIDs and come back in Postgres' lowercase form", () => {
  assert.equal(isUuid(PRODUCT_ID), true);
  assert.equal(requireUuid(PRODUCT_ID, "x"), PRODUCT_ID.toLowerCase());
  for (const value of ["draft", "", " " + PRODUCT_ID, 42, null, undefined]) {
    assert.equal(isUuid(value), false, String(value));
    refused(() => requireUuid(value, "No se encontró."), /No se encontró/);
  }
});

test("notes are trimmed, blank is null, and long ones are refused", () => {
  assert.equal(normalizeNote("  regalo ", "El motivo"), "regalo");
  assert.equal(normalizeNote("   ", "El motivo"), null);
  assert.equal(normalizeNote(undefined, "El motivo"), null);
  assert.equal(normalizeNote(null, "El motivo"), null);
  assert.equal(
    normalizeNote("ñ".repeat(MAX_NOTE_LENGTH), "El motivo")?.length,
    MAX_NOTE_LENGTH
  );
  refused(
    () => normalizeNote("x".repeat(MAX_NOTE_LENGTH + 1), "El motivo"),
    /El motivo no puede superar 200/
  );
  refused(
    () => normalizeNote(12, "La nota"),
    /La nota tiene un formato no válido/
  );
  // Counted like Postgres' char_length: one emoji is one character.
  assert.equal(characterCount("🎁🎁"), 2);
});

test("payment methods are the enum values only", () => {
  assert.equal(isPaymentMethod("cash"), true);
  assert.equal(isPaymentMethod("qr_transfer"), true);
  for (const value of ["card", "toString", "", null, 1]) {
    assert.equal(isPaymentMethod(value), false, String(value));
  }
});

test("a checkout request keeps only the fields a sale uses", () => {
  assert.deepEqual(
    parseCheckoutRequest({
      saleId: PRODUCT_ID,
      paymentMethod: "cash",
      saleDiscountCents: 500,
      saleDiscountReason: "cliente",
      extra: "ignored",
      lines: [
        {
          productId: PRODUCT_ID,
          quantity: 2,
          lineDiscountCents: null,
          tenantId: "someone-else",
        },
      ],
    }),
    {
      saleId: PRODUCT_ID.toLowerCase(),
      paymentMethod: "cash",
      saleDiscountCents: 500,
      saleDiscountReason: "cliente",
      lines: [
        {
          productId: PRODUCT_ID.toLowerCase(),
          quantity: 2,
          lineDiscountCents: undefined,
          lineDiscountReason: undefined,
        },
      ],
    }
  );
});

test("malformed checkout requests fail with a friendly message", () => {
  const valid = {
    saleId: PRODUCT_ID,
    paymentMethod: "cash",
    saleDiscountCents: 0,
    lines: [{ productId: PRODUCT_ID, quantity: 1 }],
  };
  const cases: [unknown, RegExp][] = [
    [null, /datos de la venta/],
    [{ ...valid, saleId: undefined }, /datos de la venta/],
    [{ ...valid, saleId: "sale-1" }, /datos de la venta/],
    [{ ...valid, paymentMethod: "card" }, /datos de la venta/],
    [{ ...valid, saleDiscountCents: "5" }, /datos de la venta/],
    [{ ...valid, saleDiscountReason: 3 }, /datos de la venta/],
    [{ ...valid, lines: "p1" }, /datos de la venta/],
    [{ ...valid, lines: [null] }, /datos de la venta/],
    [
      { ...valid, lines: [{ productId: PRODUCT_ID, quantity: "1" }] },
      /datos de la venta/,
    ],
    [
      {
        ...valid,
        lines: [{ productId: PRODUCT_ID, quantity: 1, lineDiscountCents: "9" }],
      },
      /datos de la venta/,
    ],
    [
      { ...valid, lines: [{ productId: "prod-1", quantity: 1 }] },
      /disponibles/,
    ],
    [
      {
        ...valid,
        lines: Array.from({ length: MAX_SALE_LINES + 1 }, () => ({
          productId: PRODUCT_ID,
          quantity: 1,
        })),
      },
      /productos distintos/,
    ],
  ];
  for (const [input, message] of cases) {
    refused(() => parseCheckoutRequest(input), message);
  }
});
