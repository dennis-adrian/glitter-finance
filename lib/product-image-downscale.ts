// Product photos are shown in small tiles, but phones take them at several
// megapixels. The editor reduces a picked photo here, in the browser, before
// either upload path (PowerSync or the uploadProductImage server action)
// sends it: uploads stay small on festival networks and the Sell grid never
// downloads or decodes full-size photos.

import { isProductImageMimeType } from "@/lib/product-image-config";

/**
 * Longest side, in pixels, of an uploaded product image. The editor preview,
 * the largest place an image is shown, fits in the 480px app column, and Sell
 * tiles are much smaller.
 */
export const PRODUCT_IMAGE_MAX_DIMENSION = 768;
export const PRODUCT_IMAGE_JPEG_QUALITY = 0.8;

// A file already within PRODUCT_IMAGE_MAX_DIMENSION and at most this size is
// uploaded as it is: re-encoding it would save little.
const SMALL_IMAGE_BYTES = 200 * 1024;

/** The size an image is drawn at so its longer side fits; never enlarges. */
export function fitProductImageSize(
  width: number,
  height: number,
  maxDimension = PRODUCT_IMAGE_MAX_DIMENSION
) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function hasTransparentPixels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const { data } = context.getImageData(0, 0, width, height);
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if (data[alpha] < 255) return true;
  }
  return false;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string
): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, type, PRODUCT_IMAGE_JPEG_QUALITY)
  );
}

function renameForType(name: string, type: string) {
  const base = name.replace(/\.[^./]*$/, "") || "producto";
  return `${base}.${type === "image/png" ? "png" : "jpg"}`;
}

/**
 * The picked photo reduced to PRODUCT_IMAGE_MAX_DIMENSION: a JPEG, or a PNG
 * when the original is a PNG with transparency (a sticker cut-out keeps its
 * transparent background). Returns the file unchanged when it is not a
 * product image type, is already small, or the browser cannot decode it
 * here; the upload rules (productImageFileError) still apply to the result.
 */
export async function downscaleProductImage(file: File): Promise<File> {
  if (
    !isProductImageMimeType(file.type) ||
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    // "from-image" applies the EXIF rotation phone cameras record.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const size = fitProductImageSize(bitmap.width, bitmap.height);
    const resized =
      size.width !== bitmap.width || size.height !== bitmap.height;
    if (!resized && file.size <= SMALL_IMAGE_BYTES) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const type =
      file.type === "image/png" &&
      hasTransparentPixels(context, size.width, size.height)
        ? "image/png"
        : "image/jpeg";
    const blob = await canvasToBlob(canvas, type);
    if (!blob || blob.type !== type || (!resized && blob.size >= file.size)) {
      return file;
    }
    return new File([blob], renameForType(file.name, type), {
      type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
