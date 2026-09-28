import assert from "node:assert/strict";
import test from "node:test";
import { countLabel } from "@/lib/plural";

test("a count takes the singular only for one", () => {
  assert.equal(countLabel(1, "venta", "ventas"), "1 venta");
  assert.equal(countLabel(0, "venta", "ventas"), "0 ventas");
  assert.equal(countLabel(2, "unidad", "unidades"), "2 unidades");
  // A product refunded more than it sold in a range.
  assert.equal(countLabel(-1, "unidad", "unidades"), "-1 unidad");
  assert.equal(countLabel(-3, "unidad", "unidades"), "-3 unidades");
});
