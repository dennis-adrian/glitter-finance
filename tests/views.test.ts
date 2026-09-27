import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRouteHash,
  parseRouteHash,
  primaryViewFor,
  type AppRoute,
} from "@/lib/views";

test("route hashes round-trip for every screen", () => {
  const routes: AppRoute[] = [
    { view: "sell" },
    { view: "cart" },
    { view: "checkout" },
    { view: "saleComplete" },
    { view: "sales" },
    { view: "saleDetail", id: "3f1c9b1e-5a0f-4c64-9e0e-1d9c4c2f0a11" },
    { view: "products" },
    { view: "editor" },
    { view: "editor", id: "prod-1" },
    { view: "reports" },
    { view: "more" },
    { view: "settings" },
    { view: "diagnostics" },
  ];

  for (const route of routes) {
    assert.deepEqual(parseRouteHash(formatRouteHash(route)), route);
  }
});

test("unknown or empty hashes fall back to selling", () => {
  assert.deepEqual(parseRouteHash(""), { view: "sell" });
  assert.deepEqual(parseRouteHash("#/"), { view: "sell" });
  assert.deepEqual(parseRouteHash("#/no-existe"), { view: "sell" });
});

test("sub-screens keep their section active in the navigation", () => {
  assert.equal(primaryViewFor("checkout"), "sell");
  assert.equal(primaryViewFor("saleDetail"), "sales");
  assert.equal(primaryViewFor("editor"), "products");
  assert.equal(primaryViewFor("diagnostics"), "more");
});
