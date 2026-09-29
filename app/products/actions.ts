"use server";

import { toActionResult, UserFacingError } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireExpectedTenantContext } from "@/lib/auth/user-context";
import {
  buildProductImageObjectPath,
  productImageCacheControl,
  productImageFileError,
  productImagesBucket,
  unreferencedProductImagePaths,
} from "@/lib/product-image-config";
import { removeProductImageObjects } from "@/lib/product-images";
import {
  archiveProductForTenant,
  createProductForTenant,
  findProductForTenant,
  restoreProductForTenant,
  updateProductImageForTenant,
  updateProductForTenant,
} from "@/lib/products/repository";
import { normalizeProductInput } from "@/lib/products";
import type { Product, ProductInput } from "@/lib/types";
import { isUuid, requireUuid } from "@/lib/validation";

const PRODUCT_NOT_FOUND_MESSAGE = "No se encontró el producto.";

// Every action takes `expectedTenantId`, the tenant the calling screen
// renders, and refuses to run once another tenant became the active one.
// Arguments come from the browser, so they are checked before any database
// work, with the same rules as the PowerSync writers (normalizeProductInput).
// Expected failures come back as `{ ok: false, error }` (lib/action-result.ts).
async function requireTenant(expectedTenantId: string) {
  return requireExpectedTenantContext(
    expectedTenantId,
    "Se requiere una cuenta para gestionar productos."
  );
}

async function requireTenantId(expectedTenantId: string) {
  const context = await requireTenant(expectedTenantId);
  return context.tenant.id;
}

// `initialStock` is the `initial` count to record with the product, if any
// (resolveInitialStockDelta): saved in the product write's own transaction,
// so tracking is never switched on without it. The repository checks it.
export async function createProduct(
  expectedTenantId: string,
  input: ProductInput,
  initialStock?: number | null
) {
  return toActionResult(async () => {
    const context = await requireTenant(expectedTenantId);
    return createProductForTenant(
      context.tenant.id,
      normalizeProductInput(input),
      initialStock == null
        ? undefined
        : { userId: context.user.id, delta: initialStock }
    );
  });
}

export async function updateProduct(
  expectedTenantId: string,
  productId: string,
  input: ProductInput,
  initialStock?: number | null
) {
  return toActionResult(async () => {
    const context = await requireTenant(expectedTenantId);
    return updateProductForTenant(
      context.tenant.id,
      requireUuid(productId, PRODUCT_NOT_FOUND_MESSAGE),
      normalizeProductInput(input),
      initialStock == null
        ? undefined
        : { userId: context.user.id, delta: initialStock }
    );
  });
}

export async function uploadProductImage(
  expectedTenantId: string,
  productId: string,
  formData: FormData
) {
  return toActionResult(() =>
    uploadProductImageForTenant(expectedTenantId, productId, formData)
  );
}

async function uploadProductImageForTenant(
  expectedTenantId: string,
  productId: string,
  formData: FormData
) {
  const tenantId = await requireTenantId(expectedTenantId);
  const image = formData instanceof FormData ? formData.get("image") : null;

  if (!(image instanceof File)) {
    throw new UserFacingError("Selecciona una imagen del producto.");
  }

  const imageError = productImageFileError(image);
  if (imageError) {
    throw new UserFacingError(imageError);
  }

  // Check the product before uploading, so a wrong id leaves no file behind.
  const current = isUuid(productId)
    ? await findProductForTenant(tenantId, productId.toLowerCase())
    : null;
  if (!current) {
    throw new UserFacingError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  // Upload with the user's session, not the service role, so Storage applies
  // the tenant-folder policy and the bucket limits to this path too.
  const objectPath = buildProductImageObjectPath(
    tenantId,
    current.id,
    image.type
  );
  const supabase = await createClient();
  const { error } = await supabase.storage
    .from(productImagesBucket)
    .upload(objectPath, new Uint8Array(await image.arrayBuffer()), {
      contentType: image.type,
      cacheControl: productImageCacheControl,
      upsert: false,
    });

  // Size, type and path were checked above, so a refusal here is an outage
  // or a policy bug: throw, so it is reported.
  if (error) {
    throw new Error("No se pudo subir la imagen.", { cause: error });
  }

  let product: Product;
  try {
    product = await updateProductImageForTenant(
      tenantId,
      current.id,
      objectPath
    );
  } catch (updateError) {
    await removeUnreferencedProductImages([objectPath]);
    throw updateError;
  }

  // The replaced image, or this upload if a newer edit kept another image.
  await removeUnreferencedProductImages(
    unreferencedProductImagePaths({
      tenantId,
      productId: current.id,
      requestedPath: objectPath,
      previousPath: current.imagePath,
      storedPath: product.imagePath,
    })
  );
  return product;
}

// Cleanup runs with the service role, so it works even before the Storage
// delete policy is installed. Callers pass only paths inside the caller's
// tenant folder (unreferencedProductImagePaths checks it).
async function removeUnreferencedProductImages(paths: string[]) {
  if (paths.length === 0) return;
  try {
    await removeProductImageObjects(createAdminClient(), paths);
  } catch (error) {
    console.warn("[uploadProductImage] could not remove unused images", {
      paths,
      error,
    });
  }
}

export async function archiveProduct(
  expectedTenantId: string,
  productId: string
) {
  return toActionResult(async () => {
    const tenantId = await requireTenantId(expectedTenantId);
    return archiveProductForTenant(
      tenantId,
      requireUuid(productId, PRODUCT_NOT_FOUND_MESSAGE)
    );
  });
}

export async function restoreProduct(
  expectedTenantId: string,
  productId: string
) {
  return toActionResult(async () => {
    const tenantId = await requireTenantId(expectedTenantId);
    return restoreProductForTenant(
      tenantId,
      requireUuid(productId, PRODUCT_NOT_FOUND_MESSAGE)
    );
  });
}
