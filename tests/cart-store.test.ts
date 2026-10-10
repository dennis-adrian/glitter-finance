import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { usePosStore } from "@/lib/store";
import type { Product } from "@/lib/types";

const pin: Product = {
  id: "pin",
  name: "Pin",
  priceCents: 1000,
  costCents: null,
  categoryId: null,
  category: "Pines",
  imagePath: null,
  imageUrl: null,
  imageTone: "violet",
  tracksInventory: false,
  lowStockThreshold: null,
  archivedAt: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

function line() {
  return usePosStore.getState().cart.find((item) => item.productId === "pin");
}

beforeEach(() => {
  const store = usePosStore.getState();
  store.clearLocalData();
  store.hydrateProducts([pin]);
  store.addToCart("pin");
  store.addToCart("pin");
  store.addToCart("pin");
});

test("a line discount shrinks with the quantity and does not come back", () => {
  const store = usePosStore.getState();
  store.setLineDiscount("pin", 2000, "combo");

  store.decrementCart("pin");
  assert.equal(line()?.lineDiscountCents, 2000);

  store.decrementCart("pin");
  assert.equal(line()?.quantity, 1);
  assert.equal(line()?.lineDiscountCents, 1000);

  store.addToCart("pin");
  store.addToCart("pin");
  assert.equal(line()?.quantity, 3);
  assert.equal(line()?.lineDiscountCents, 1000);
  assert.equal(line()?.lineDiscountReason, "combo");
});

test("a line discount is clamped again when the product price drops", () => {
  const store = usePosStore.getState();
  store.setLineDiscount("pin", 2500);

  store.upsertProduct({ ...pin, priceCents: 500 });
  assert.equal(line()?.lineDiscountCents, 1500);

  store.hydrateProducts([{ ...pin, priceCents: 200 }]);
  assert.equal(line()?.lineDiscountCents, 600);
});

test("a discount is stored as whole cents within the line", () => {
  const store = usePosStore.getState();

  store.setLineDiscount("pin", 99_999);
  assert.equal(line()?.lineDiscountCents, 3000);

  store.setLineDiscount("pin", Number.NaN);
  assert.equal(line()?.lineDiscountCents, 0);

  store.setLineDiscount("pin", 12.4);
  assert.equal(line()?.lineDiscountCents, 12);
});

test("undoing an emptied cart brings its lines back", () => {
  const store = usePosStore.getState();
  store.setLineDiscount("pin", 500, "feria");
  const lines = usePosStore.getState().cart;

  store.clearCart();
  const clearedRevision = usePosStore.getState().cartRevision;
  store.restoreCart(lines, clearedRevision);

  assert.deepEqual(usePosStore.getState().cart, lines);
  assert.notEqual(usePosStore.getState().cartUpdatedAt, null);
  assert.equal(usePosStore.getState().cartRevision, clearedRevision + 1);
});

test("an undo never overwrites a cart changed after emptying it", () => {
  const store = usePosStore.getState();
  const lines = usePosStore.getState().cart;

  store.clearCart();
  const clearedRevision = usePosStore.getState().cartRevision;
  store.addToCart("pin");
  store.restoreCart(lines, clearedRevision);

  assert.equal(line()?.quantity, 1);
});
