import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  buildProductImageObjectPath,
  encodePlaceholderImagePath,
  isProductImageObjectPath,
  placeholderImageTone,
  productImageAccept,
  productImageFileError,
  productImageFormatsLabel,
  productImageMaxBytes,
  productImageMaxSizeLabel,
  productImagePublicPathPrefix,
  unreferencedProductImagePaths,
} from "@/lib/product-image-config";
import { getProductImagePublicUrl } from "@/lib/product-images";
import { mapDbProductToProduct } from "@/lib/product-mapper";
import {
  isStaticAssetCacheName,
  PRODUCT_IMAGE_CACHE_NAME,
  PRODUCT_IMAGE_PATH_PREFIX,
} from "@/lib/pwa/cache-names";
import { updateProductLocal } from "@/lib/powersync/write-products";

const tenantId = "70000000-0000-4000-8000-000000000001";
const productId = "80000000-0000-4000-8000-000000000001";
const owner = { tenantId, productId };
const imageA = `${tenantId}/products/${productId}/aaaaaaaa-0000-4000-8000-000000000001.jpg`;
const imageB = `${tenantId}/products/${productId}/bbbbbbbb-0000-4000-8000-000000000002.png`;

test("image messages follow the configured limits", () => {
  assert.equal(productImageMaxSizeLabel, "5 MB");
  assert.equal(productImageFormatsLabel, "JPG y PNG");
  assert.equal(productImageAccept, "image/jpeg,image/png");
  assert.equal(
    productImageFileError({ size: 1, type: "image/webp" }),
    "La imagen debe estar en formato JPG o PNG."
  );
  assert.equal(
    productImageFileError({ size: 0, type: "image/png" }),
    "La imagen seleccionada está vacía."
  );
  assert.equal(
    productImageFileError({
      size: productImageMaxBytes + 1,
      type: "image/jpeg",
    }),
    "La imagen no puede superar 5 MB."
  );
  assert.equal(
    productImageFileError({ size: productImageMaxBytes, type: "image/jpeg" }),
    null
  );
  assert.equal(productImageFileError({ size: 1, type: "image/png" }), null);
});

test("placeholder paths name a known tone or fall back to the default", () => {
  assert.equal(encodePlaceholderImagePath("coral"), "placeholder:coral");
  assert.equal(encodePlaceholderImagePath("neon"), "placeholder:violet");
  assert.equal(encodePlaceholderImagePath(), "placeholder:violet");
  assert.equal(placeholderImageTone("placeholder:warm"), "warm");
  assert.equal(placeholderImageTone("placeholder:neon"), null);
  assert.equal(placeholderImageTone(imageA), null);
  assert.equal(placeholderImageTone(null), null);
});

test("the mapper keeps a placeholder's tone and derives one otherwise", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "publishable-key";
  const row = {
    id: productId,
    name: "Print",
    priceCents: 4000,
    costCents: null,
    category: "Prints",
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const placeholder = mapDbProductToProduct({
    ...row,
    imagePath: "placeholder:linen",
  });
  const uploaded = mapDbProductToProduct({ ...row, imagePath: imageA });
  const unknownTone = mapDbProductToProduct({
    ...row,
    imagePath: "placeholder:neon",
  });

  assert.equal(placeholder.imageTone, "linen");
  assert.equal(placeholder.imageUrl, null);
  assert.equal(uploaded.imageTone, unknownTone.imageTone);
  assert.notEqual(uploaded.imageUrl, null);
});

test("the service worker caches the public image URLs until logout", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "publishable-key";

  assert.equal(PRODUCT_IMAGE_PATH_PREFIX, productImagePublicPathPrefix);
  assert.ok(
    new URL(getProductImagePublicUrl(imageA) ?? "").pathname.startsWith(
      PRODUCT_IMAGE_PATH_PREFIX
    )
  );
  assert.equal(isStaticAssetCacheName(PRODUCT_IMAGE_CACHE_NAME), false);
});

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
