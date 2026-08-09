"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import {
  productImageMaxBytes,
  productImageMimeTypes,
  productImagesBucket,
} from "@/lib/product-image-config";
import {
  archiveProductForTenant,
  createProductForTenant,
  restoreProductForTenant,
  updateProductImageForTenant,
  updateProductForTenant,
} from "@/lib/products/repository";
import type { ProductInput } from "@/lib/types";

const imageExtensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

async function requireTenantId() {
  const context = await ensureUserTenantContext();

  if (!context?.tenant) {
    throw new Error("Se requiere una cuenta para gestionar productos.");
  }

  return context.tenant.id;
}

export async function createProduct(input: ProductInput) {
  const tenantId = await requireTenantId();
  return createProductForTenant(tenantId, input);
}

export async function updateProduct(productId: string, input: ProductInput) {
  const tenantId = await requireTenantId();
  return updateProductForTenant(tenantId, productId, input);
}

export async function uploadProductImage(
  productId: string,
  formData: FormData
) {
  const tenantId = await requireTenantId();
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

  const extension = imageExtensionByMimeType[image.type] ?? "jpg";
  const objectPath = `${tenantId}/products/${productId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await createAdminClient()
    .storage.from(productImagesBucket)
    .upload(objectPath, new Uint8Array(await image.arrayBuffer()), {
      contentType: image.type,
      upsert: false,
    });

  if (error) {
    throw new Error("No se pudo subir la imagen.");
  }

  return updateProductImageForTenant(tenantId, productId, objectPath);
}

export async function archiveProduct(productId: string) {
  const tenantId = await requireTenantId();
  return archiveProductForTenant(tenantId, productId);
}

export async function restoreProduct(productId: string) {
  const tenantId = await requireTenantId();
  return restoreProductForTenant(tenantId, productId);
}
