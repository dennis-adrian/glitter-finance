import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRouteHash,
  isPrimaryView,
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
    { view: "categories" },
    { view: "reports" },
    { view: "sellerSales", sellerId: "7d0e2c4a-1b3f-4e5d-9a8b-6c7d8e9f0a12" },
    {
      view: "sellerSaleDetail",
      sellerId: "7d0e2c4a-1b3f-4e5d-9a8b-6c7d8e9f0a12",
      id: "3f1c9b1e-5a0f-4c64-9e0e-1d9c4c2f0a11",
    },
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
  assert.equal(primaryViewFor("categories"), "products");
  assert.equal(primaryViewFor("diagnostics"), "more");
  assert.equal(primaryViewFor("sellerSales"), "reports");
  assert.equal(primaryViewFor("sellerSaleDetail"), "reports");
  // A seller's sales are a sub-screen: phones hide the bottom nav.
  assert.equal(isPrimaryView("reports"), true);
  assert.equal(isPrimaryView("sellerSales"), false);
  assert.equal(isPrimaryView("sellerSaleDetail"), false);
});

test("seller routes live under Reportes, and anything else there is Reportes", () => {
  assert.deepEqual(parseRouteHash("#/reportes/vendedor"), { view: "reports" });
  assert.deepEqual(parseRouteHash("#/reportes/vendedor/"), { view: "reports" });
  assert.deepEqual(parseRouteHash("#/reportes/otra/u1"), { view: "reports" });
  assert.deepEqual(parseRouteHash("#/reportes/vendedor/u1"), {
    view: "sellerSales",
    sellerId: "u1",
  });
  assert.deepEqual(parseRouteHash("#/reportes/vendedor/u1/s1/extra"), {
    view: "sellerSaleDetail",
    sellerId: "u1",
    id: "s1",
  });
  // Without a sale, a seller's sale detail is their list; without a seller,
  // Reports.
  assert.equal(
    formatRouteHash({ view: "sellerSaleDetail", sellerId: "u1" }),
    "#/reportes/vendedor/u1"
  );
  assert.equal(formatRouteHash({ view: "sellerSales" }), "#/reportes");

  const odd: AppRoute = { view: "sellerSales", sellerId: "a/b c%" };
  assert.equal(formatRouteHash(odd), "#/reportes/vendedor/a%2Fb%20c%25");
  assert.deepEqual(parseRouteHash(formatRouteHash(odd)), odd);
});
