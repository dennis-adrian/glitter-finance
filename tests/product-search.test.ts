import assert from "node:assert/strict";
import test from "node:test";
import { ALL_CATEGORIES } from "@/lib/categories";
import { filterProducts, normalizeSearchText } from "@/lib/products";

const catalog = [
  { name: "Lámina ilustrada", category: "Prints" },
  { name: "Sticker de pingüino", category: "Stickers" },
  { name: "PIN corazón", category: "Pines" },
];

const names = (products: typeof catalog) =>
  products.map((product) => product.name);

test("search ignores case, accents and surrounding spaces", () => {
  assert.equal(normalizeSearchText("  Lámina Ñandú "), "lamina nandu");
  assert.deepEqual(names(filterProducts(catalog, ALL_CATEGORIES, "lamina")), [
    "Lámina ilustrada",
  ]);
  assert.deepEqual(names(filterProducts(catalog, ALL_CATEGORIES, "PINGUINO")), [
    "Sticker de pingüino",
  ]);
  assert.deepEqual(names(filterProducts(catalog, ALL_CATEGORIES, "corazon ")), [
    "PIN corazón",
  ]);
});

test("search combines the category and the query", () => {
  assert.equal(filterProducts(catalog, ALL_CATEGORIES, "").length, 3);
  assert.deepEqual(names(filterProducts(catalog, "Pines", "")), [
    "PIN corazón",
  ]);
  assert.deepEqual(filterProducts(catalog, "Pines", "lamina"), []);
});
