import assert from "node:assert/strict";
import test from "node:test";
import {
  downscaleProductImage,
  fitProductImageSize,
  PRODUCT_IMAGE_MAX_DIMENSION,
} from "@/lib/product-image-downscale";

test("fits the longer side and keeps the proportions", () => {
  assert.deepEqual(fitProductImageSize(4032, 3024), {
    width: PRODUCT_IMAGE_MAX_DIMENSION,
    height: 576,
  });
  assert.deepEqual(fitProductImageSize(3024, 4032), {
    width: 576,
    height: PRODUCT_IMAGE_MAX_DIMENSION,
  });
  assert.deepEqual(fitProductImageSize(2000, 2000), {
    width: PRODUCT_IMAGE_MAX_DIMENSION,
    height: PRODUCT_IMAGE_MAX_DIMENSION,
  });
});

test("never enlarges a small image or rounds a side to zero", () => {
  assert.deepEqual(fitProductImageSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(fitProductImageSize(10000, 5), {
    width: PRODUCT_IMAGE_MAX_DIMENSION,
    height: 1,
  });
});

test("returns the picked file when it cannot be reduced here", async () => {
  const pdf = new File(["%PDF"], "lista.pdf", { type: "application/pdf" });
  const photo = new File([new Uint8Array(16)], "foto.jpg", {
    type: "image/jpeg",
  });

  // Not a product image type: the upload rules reject it afterwards.
  assert.equal(await downscaleProductImage(pdf), pdf);
  // No createImageBitmap or canvas (as in this test runtime, or an old
  // browser): uploaded as it is, within the size limit.
  assert.equal(await downscaleProductImage(photo), photo);
});
