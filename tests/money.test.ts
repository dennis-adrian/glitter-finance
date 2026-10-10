import assert from "node:assert/strict";
import test from "node:test";
import { validateProductForm } from "@/components/screens/product-editor.helpers";
import {
  clampDiscount,
  formatBs,
  INT4_MAX,
  isValidCents,
  MAX_PRICE_CENTS,
  parseBolivianos,
  parseDiscountInput,
} from "@/lib/money";

test("amounts parse as typed, including the es-BO grouping formatBs shows", () => {
  const cases: [string, number][] = [
    ["15", 1500],
    ["15,50", 1550],
    ["15.5", 1550],
    ["0,5", 50],
    ["0", 0],
    ["15,", 1500],
    ["1.500", 150_000],
    ["12.345", 1_234_500],
    ["1.234,50", 123_450],
    ["1.234.567,89", 123_456_789],
    ["1 500", 150_000],
    ["1 234,5", 123_450],
    ["1.50", 150],
    ["  7 ", 700],
    ["Bs 12,50", 1250],
    ["12,50 Bs", 1250],
  ];
  for (const [input, cents] of cases) {
    assert.equal(parseBolivianos(input), cents, input);
  }
});

test("anything that is not an amount is null, never 0 or a guess", () => {
  for (const input of [
    "",
    "   ",
    "abc",
    "-5",
    "+5",
    "1e3",
    "12.3.4",
    "1,500",
    "1,234.50",
    "12,345",
    "1.2345",
    "0.500",
    "0.250",
    "00.500",
    "012.345",
    "0 500",
    "Bs 0.250",
    "15 u",
    "99999999999999999999",
  ]) {
    assert.equal(parseBolivianos(input), null, input);
  }
});

test("formatted amounts parse back to the same cents", () => {
  for (const cents of [0, 5, 150, 1550, 99_999, 150_000, 123_450, 12_345_678]) {
    assert.equal(parseBolivianos(formatBs(cents)), cents, formatBs(cents));
    assert.equal(parseBolivianos(formatBs(cents, true)), cents);
    assert.equal(parseBolivianos(String(cents / 100)), cents);
  }
});

test("discounts accept amounts and percentages, and reject malformed ones", () => {
  assert.equal(parseDiscountInput("7", 10_000), 700);
  assert.equal(parseDiscountInput("7,50", 10_000), 750);
  assert.equal(parseDiscountInput("10%", 10_000), 1000);
  assert.equal(parseDiscountInput("12,5%", 10_000), 1250);
  assert.equal(parseDiscountInput("12.5 %", 10_000), 1250);
  assert.equal(parseDiscountInput("100%", 10_000), 10_000);
  assert.equal(parseDiscountInput("33%", 1001), 330);
  assert.equal(parseDiscountInput("", 10_000), 0);

  for (const input of [
    "%",
    "abc%",
    ",5%",
    "x",
    "150%",
    "-10%",
    "10%%",
    "0.500",
  ]) {
    assert.equal(parseDiscountInput(input, 10_000), null, input);
  }
  assert.equal(parseDiscountInput("10%", Number.NaN), null);
});

test("clampDiscount keeps discounts whole and within the subtotal", () => {
  assert.equal(clampDiscount(500, 1000), 500);
  assert.equal(clampDiscount(1500, 1000), 1000);
  assert.equal(clampDiscount(-3, 1000), 0);
  assert.equal(clampDiscount(12.6, 1000), 13);
  assert.equal(clampDiscount(Number.NaN, 1000), 0);
  assert.equal(clampDiscount(Number.POSITIVE_INFINITY, 1000), 0);
  assert.equal(clampDiscount(500, Number.NaN), 0);
  assert.equal(clampDiscount(500, -10), 0);
});

test("valid cents are whole, non-negative and within the bound", () => {
  assert.equal(isValidCents(0), true);
  assert.equal(isValidCents(MAX_PRICE_CENTS), true);
  assert.equal(isValidCents(MAX_PRICE_CENTS + 1), false);
  assert.equal(isValidCents(MAX_PRICE_CENTS + 1, INT4_MAX), true);
  assert.equal(isValidCents(INT4_MAX + 1, INT4_MAX), false);
  for (const value of [-1, 1.5, Number.NaN, null, "100", undefined]) {
    assert.equal(isValidCents(value), false, String(value));
  }
});

test("the product form rejects unparseable and out-of-range amounts", () => {
  assert.deepEqual(
    validateProductForm({ name: " Pin ", price: "1.500", cost: "" }),
    {
      values: { name: "Pin", priceCents: 150_000, costCents: null },
      errors: {},
    }
  );
  assert.deepEqual(
    validateProductForm({ name: "Pin", price: "15", cost: "0" }).values,
    { name: "Pin", priceCents: 1500, costCents: 0 }
  );

  const junkCost = validateProductForm({ name: "Pin", price: "15", cost: "x" });
  assert.equal(junkCost.values, null);
  assert.match(junkCost.errors.cost ?? "", /costo/);

  const hugePrice = validateProductForm({
    name: "Pin",
    price: "99999999",
    cost: "",
  });
  assert.equal(hugePrice.values, null);
  assert.match(hugePrice.errors.price ?? "", /1\.000\.000/);

  assert.match(
    validateProductForm({ name: "Pin", price: "0", cost: "" }).errors.price ??
      "",
    /mayor que 0/
  );
  assert.deepEqual(validateProductForm({ name: "", price: "", cost: "" }), {
    values: null,
    errors: {},
  });
});
