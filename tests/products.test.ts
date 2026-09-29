import assert from "node:assert/strict";
import test from "node:test";
import { categoriesInUse } from "@/lib/products";

test("filter chips only list categories that have products", () => {
  assert.deepEqual(
    categoriesInUse(
      ["Accesorios", "Llaveros", "Pines", "Prints"],
      [{ category: "Pines" }, { category: "Accesorios" }, { category: "Pines" }]
    ),
    ["Accesorios", "Pines"]
  );
  assert.deepEqual(categoriesInUse(["Pines"], []), []);
});
