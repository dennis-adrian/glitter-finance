import assert from "node:assert/strict";
import test from "node:test";
import {
  categoriesInUse,
  categoryIndex,
  categoryLabel,
  categoryOptions,
  effectiveCategoryId,
  productCategoryKey,
} from "@/lib/products";

const categories = [
  { id: "c-acc", name: "Accesorios" },
  { id: "c-lla", name: "Llaveros" },
  { id: "c-pin", name: "Pines" },
  { id: "c-pri", name: "Prints" },
];
const index = categoryIndex(categories);

test("products resolve their category by id, else by name", () => {
  // Id wins over a stale name (e.g. before the rename syncs back).
  assert.equal(
    effectiveCategoryId({ categoryId: "c-pin", category: "Pins" }, index),
    "c-pin"
  );
  // Not linked yet: same name, any case or spacing.
  assert.equal(
    effectiveCategoryId({ categoryId: null, category: " prints " }, index),
    "c-pri"
  );
  assert.equal(
    effectiveCategoryId({ categoryId: null, category: "Tazas" }, index),
    null
  );
  assert.equal(
    productCategoryKey({ categoryId: null, category: "Tazas" }, index),
    "name:tazas"
  );
  assert.equal(
    categoryLabel({ categoryId: "c-pin", category: "Pins" }, index),
    "Pines"
  );
  assert.equal(
    categoryLabel({ categoryId: "c-missing", category: "Tazas" }, index),
    "Tazas"
  );
});

test("filter chips only list categories that have products", () => {
  const products = [
    { categoryId: "c-pin", category: "Pines" },
    { categoryId: null, category: "accesorios" },
    { categoryId: "c-pin", category: "Pines" },
    // Category not synced to this device yet: gets its own chip.
    { categoryId: "c-new", category: "Tazas" },
  ];
  const options = categoryOptions(categories, products, index);

  assert.deepEqual(categoriesInUse(options, products, index), [
    { id: "c-acc", label: "Accesorios" },
    { id: "c-pin", label: "Pines" },
    { id: "c-new", label: "Tazas" },
  ]);
  assert.deepEqual(categoriesInUse(options, [], index), []);
});
