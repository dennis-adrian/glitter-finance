import assert from "node:assert/strict";
import test from "node:test";
import { deriveCategories, resolveCategoryName } from "@/lib/products";

test("categories come from products, deduplicated and sorted", () => {
  assert.deepEqual(
    deriveCategories([
      { category: "Pines" },
      { category: "llaveros" },
      { category: "Accesorios" },
      { category: "Llaveros" },
      { category: "Nanduti" },
      { category: "  " },
      { category: "Ñandutí" },
    ]),
    ["Accesorios", "llaveros", "Nanduti", "Pines"]
  );
});

test("typed categories reuse existing spellings", () => {
  const existing = ["Llaveros", "Láminas"];
  assert.equal(resolveCategoryName("  llaveros ", existing), "Llaveros");
  assert.equal(resolveCategoryName("laminas", existing), "Láminas");
  assert.equal(resolveCategoryName("Tote   bags", existing), "Tote bags");
  assert.equal(resolveCategoryName("x".repeat(60), existing).length, 40);
});
