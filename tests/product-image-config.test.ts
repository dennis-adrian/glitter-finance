import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  buildProductImageObjectPath,
  isProductImageObjectPath,
  unreferencedProductImagePaths,
} from "@/lib/product-image-config";
import { updateProductLocal } from "@/lib/powersync/write-products";

const tenantId = "70000000-0000-4000-8000-000000000001";
const productId = "80000000-0000-4000-8000-000000000001";
const owner = { tenantId, productId };
const imageA = `${tenantId}/products/${productId}/aaaaaaaa-0000-4000-8000-000000000001.jpg`;
const imageB = `${tenantId}/products/${productId}/bbbbbbbb-0000-4000-8000-000000000002.png`;

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
  assert.equal(isProductImageObjectPath(jpeg, owner), true);
  assert.equal(isProductImageObjectPath(png, owner), true);
});

test("recognizes only this product's uploaded images", () => {
  assert.equal(isProductImageObjectPath(imageA, owner), true);
  assert.equal(isProductImageObjectPath(imageA.toUpperCase(), owner), true);
  assert.equal(isProductImageObjectPath(null, owner), false);
  assert.equal(isProductImageObjectPath("placeholder:violet", owner), false);
  assert.equal(isProductImageObjectPath("seed/print-seed.jpg", owner), false);
  assert.equal(
    isProductImageObjectPath(imageA, {
      tenantId: "70000000-0000-4000-8000-000000000002",
      productId,
    }),
    false
  );
  assert.equal(
    isProductImageObjectPath(imageA, {
      tenantId,
      productId: "80000000-0000-4000-8000-000000000002",
    }),
    false
  );
  assert.equal(
    isProductImageObjectPath(
      `${tenantId}/products/${productId}/nested/aaaaaaaa-0000-4000-8000-000000000001.jpg`,
      owner
    ),
    false
  );
  assert.equal(
    isProductImageObjectPath(
      `${tenantId}/products/${productId}/aaaaaaaa-0000-4000-8000-000000000001.html`,
      owner
    ),
    false
  );
});

test("an applied image write frees the image it replaced", () => {
  assert.deepEqual(
    unreferencedProductImagePaths({
      ...owner,
      requestedPath: imageB,
      previousPath: imageA,
      storedPath: imageB,
    }),
    [imageA]
  );
});

test("an image write that lost to a newer edit frees its own upload", () => {
  assert.deepEqual(
    unreferencedProductImagePaths({
      ...owner,
      requestedPath: imageB,
      previousPath: imageA,
      storedPath: imageA,
    }),
    [imageB]
  );
});

test("placeholders, seed images and unchanged paths are never freed", () => {
  assert.deepEqual(
    unreferencedProductImagePaths({
      ...owner,
      requestedPath: imageA,
      previousPath: "placeholder:coral",
      storedPath: imageA,
    }),
    []
  );
  assert.deepEqual(
    unreferencedProductImagePaths({
      ...owner,
      requestedPath: imageA,
      previousPath: "seed/print-seed.jpg",
      storedPath: imageA,
    }),
    []
  );
  assert.deepEqual(
    unreferencedProductImagePaths({
      ...owner,
      requestedPath: imageA,
      previousPath: imageA,
      storedPath: imageA,
    }),
    []
  );
  assert.deepEqual(
    unreferencedProductImagePaths({
      ...owner,
      requestedPath: "placeholder:warm",
      previousPath: imageA,
      storedPath: imageA,
    }),
    []
  );
});

test("a product edit never writes the editor's copy of an uploaded image", async () => {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db = {
    execute: async (sql: string, params: unknown[]) => {
      writes.push({ sql, params });
    },
  } as unknown as AbstractPowerSyncDatabase;
  const product = {
    name: "Print",
    priceCents: 4000,
    costCents: null,
    category: "Prints",
    imageTone: "coral",
    tracksInventory: false,
  };

  await updateProductLocal(db, {
    tenantId,
    productId,
    product: { ...product, imagePath: imageA },
  });
  await updateProductLocal(db, {
    tenantId,
    productId,
    product: { ...product, imagePath: "placeholder:violet" },
  });

  for (const write of writes) {
    assert.match(
      write.sql,
      /image_path = CASE\s+WHEN image_path IS NULL OR image_path LIKE \?\s+THEN coalesce\(\?, image_path\)\s+ELSE image_path\s+END/
    );
    assert.match(write.sql, /updated_at = \?/);
    assert.equal(write.params.includes(imageA), false);
  }
  assert.equal(writes[0].params[5], null);
  assert.equal(writes[1].params[4], "placeholder:%");
  assert.equal(writes[1].params[5], "placeholder:coral");
});
