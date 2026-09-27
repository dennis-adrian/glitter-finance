"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireExpectedTenantContext } from "@/lib/auth/user-context";
import {
  buildProductImageObjectPath,
  productImageMaxBytes,
  productImageMimeTypes,
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
import type { Product, ProductInput } from "@/lib/types";

const PRODUCT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every action takes `expectedTenantId`, the tenant the calling screen
// renders, and refuses to run once another tenant became the active one.
async function requireTenantId(expectedTenantId: string) {
  const context = await requireExpectedTenantContext(
    expectedTenantId,
    "Se requiere una cuenta para gestionar productos."
  );
  return context.tenant.id;
}

export async function createProduct(
  expectedTenantId: string,
  input: ProductInput
) {
  const tenantId = await requireTenantId(expectedTenantId);
  return createProductForTenant(tenantId, input);
}

export async function updateProduct(
  expectedTenantId: string,
  productId: string,
  input: ProductInput
) {
  const tenantId = await requireTenantId(expectedTenantId);
  return updateProductForTenant(tenantId, productId, input);
}

export async function uploadProductImage(
  expectedTenantId: string,
  productId: string,
  formData: FormData
) {
  const tenantId = await requireTenantId(expectedTenantId);
  const image = formData.get("image");

  if (!(image instanceof File)) {
    throw new Error("Selecciona una imagen del producto.");
  }

  if (image.size <= 0) {
    throw new Error("La imagen seleccionada está vacía.");
  }

  if (image.size > productImageMaxBytes) {
    throw new Error("La imagen no puede superar 5MB.");
  }

  if (!productImageMimeTypes.some((type) => type === image.type)) {
    throw new Error("La imagen debe estar en formato JPG o PNG.");
  }

  // Check the product before uploading, so a wrong id leaves no file behind.
  const current = PRODUCT_ID_RE.test(productId)
    ? await findProductForTenant(tenantId, productId)
    : null;
  if (!current) {
    throw new Error("No se encontró el producto.");
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
      upsert: false,
    });

  if (error) {
    throw new Error("No se pudo subir la imagen.");
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
  const tenantId = await requireTenantId(expectedTenantId);
  return archiveProductForTenant(tenantId, productId);
}

export async function restoreProduct(
  expectedTenantId: string,
  productId: string
) {
  const tenantId = await requireTenantId(expectedTenantId);
  return restoreProductForTenant(tenantId, productId);
}
