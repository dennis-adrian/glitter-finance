import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import {
  encodePlaceholderImagePath,
  mapDbProductToProduct,
} from "@/lib/product-mapper";
import { isPlaceholderImagePath } from "@/lib/product-image-config";
import type { Product, ProductInput } from "@/lib/types";

function resolveInputImagePath(input: ProductInput) {
  if (isPlaceholderImagePath(input.imagePath)) {
    return encodePlaceholderImagePath(input.imageTone);
  }

  return input.imagePath;
}

export async function getProductsForTenant(
  tenantId: string
): Promise<Product[]> {
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.tenantId, tenantId))
    .orderBy(asc(products.archivedAt), asc(products.name));

  return rows.map(mapDbProductToProduct);
}

export async function createProductForTenant(
  tenantId: string,
  input: ProductInput
): Promise<Product> {
  const [product] = await db
    .insert(products)
    .values({
      tenantId,
      name: input.name,
      priceCents: input.priceCents,
      costCents: input.costCents,
      category: input.category,
      imagePath: resolveInputImagePath(input),
      tracksInventory: input.tracksInventory ?? false,
      lowStockThreshold: input.lowStockThreshold ?? null,
    })
    .returning();

  if (!product) {
    throw new Error("No se pudo crear el producto.");
  }

  return mapDbProductToProduct(product);
}

export async function updateProductForTenant(
  tenantId: string,
  productId: string,
  input: ProductInput
): Promise<Product> {
  const updates: {
    name: string;
    priceCents: number;
    costCents: number | null;
    category: string;
    imagePath: string | null;
    tracksInventory?: boolean;
    lowStockThreshold?: number | null;
    updatedAt: Date;
  } = {
    name: input.name,
    priceCents: input.priceCents,
    costCents: input.costCents,
    category: input.category,
    imagePath: resolveInputImagePath(input) ?? null,
    updatedAt: new Date(),
  };

  if ("tracksInventory" in input) {
    updates.tracksInventory = input.tracksInventory ?? false;
  }
  if ("lowStockThreshold" in input) {
    updates.lowStockThreshold = input.lowStockThreshold ?? null;
  }

  const [product] = await db
    .update(products)
    .set(updates)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .returning();

  if (!product) {
    throw new Error("No se encontró el producto.");
  }

  return mapDbProductToProduct(product);
}

export async function updateProductImageForTenant(
  tenantId: string,
  productId: string,
  imagePath: string
): Promise<Product> {
  const [product] = await db
    .update(products)
    .set({
      imagePath,
      updatedAt: new Date(),
    })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .returning();

  if (!product) {
    throw new Error("No se encontró el producto.");
  }

  return mapDbProductToProduct(product);
}

export async function archiveProductForTenant(
  tenantId: string,
  productId: string
): Promise<Product> {
  const [product] = await db
    .update(products)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .returning();

  if (!product) {
    throw new Error("No se encontró el producto.");
  }

  return mapDbProductToProduct(product);
}

export async function restoreProductForTenant(
  tenantId: string,
  productId: string
): Promise<Product> {
  const [product] = await db
    .update(products)
    .set({
      archivedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .returning();

  if (!product) {
    throw new Error("No se encontró el producto.");
  }

  return mapDbProductToProduct(product);
}
