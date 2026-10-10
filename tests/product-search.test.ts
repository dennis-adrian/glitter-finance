import assert from "node:assert/strict";
import test from "node:test";
import {
  allCategoriesOption,
  categoryIndex,
  filterProducts,
  normalizeSearchText,
} from "@/lib/products";

const index = categoryIndex([
  { id: "c-pri", name: "Prints" },
  { id: "c-sti", name: "Stickers" },
  { id: "c-pin", name: "Pines" },
]);

const catalog = [
  { name: "Lámina ilustrada", categoryId: "c-pri", category: "Prints" },
  { name: "Sticker de pingüino", categoryId: "c-sti", category: "Stickers" },
  // Not linked by id yet: filed under its category by name.
  { name: "PIN corazón", categoryId: null, category: "pines" },
];

const names = (products: typeof catalog) =>
  products.map((product) => product.name);
const all = allCategoriesOption.id;

test("search ignores case, accents and surrounding spaces", () => {
  assert.equal(normalizeSearchText("  Lámina Ñandú "), "lamina nandu");
  assert.deepEqual(names(filterProducts(catalog, all, "lamina", index)), [
    "Lámina ilustrada",
  ]);
  assert.deepEqual(names(filterProducts(catalog, all, "PINGUINO", index)), [
    "Sticker de pingüino",
  ]);
  assert.deepEqual(names(filterProducts(catalog, all, "corazon ", index)), [
    "PIN corazón",
  ]);
});

test("search combines the category and the query", () => {
  assert.equal(filterProducts(catalog, all, "", index).length, 3);
  assert.deepEqual(names(filterProducts(catalog, "c-pin", "", index)), [
    "PIN corazón",
  ]);
  assert.deepEqual(filterProducts(catalog, "c-pin", "lamina", index), []);
});
