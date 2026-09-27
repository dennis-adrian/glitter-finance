import assert from "node:assert/strict";
import test from "node:test";
import { buildProductImageObjectPath } from "@/lib/product-image-config";

const tenantId = "70000000-0000-4000-8000-000000000001";
const productId = "80000000-0000-4000-8000-000000000001";

test("builds a fresh object path in the product folder", () => {
  const jpeg = buildProductImageObjectPath(tenantId, productId, "image/jpeg");
  const png = buildProductImageObjectPath(tenantId, productId, "image/png");
  const fileName =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

  assert.ok(jpeg.startsWith(`${tenantId}/products/${productId}/`));
  assert.match(jpeg.split("/")[3], fileName);
  assert.match(jpeg, /\.jpg$/);
  assert.match(png, /\.png$/);
  assert.notEqual(
    buildProductImageObjectPath(tenantId, productId, "image/jpeg"),
    jpeg
  );
});
