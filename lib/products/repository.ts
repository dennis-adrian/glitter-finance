import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { mapDbProductToProduct } from "@/lib/product-mapper";
import type { Product, ProductInput } from "@/lib/types";

export async function getProductsForTenant(tenantId: string): Promise<Product[]> {
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.tenantId, tenantId))
    .orderBy(asc(products.archivedAt), asc(products.name));

  return rows.map(mapDbProductToProduct);
}

export async function createProductForTenant(tenantId: string, input: ProductInput): Promise<Product> {
  const [product] = await db
    .insert(products)
    .values({
      tenantId,
      name: input.name,
      priceCents: input.priceCents,
      costCents: input.costCents,
      category: input.category,
    })
    .returning();

  if (!product) {
    throw new Error("Unable to create product.");
  }

  return mapDbProductToProduct(product);
}

export async function updateProductForTenant(tenantId: string, productId: string, input: ProductInput): Promise<Product> {
  const [product] = await db
    .update(products)
    .set({
      name: input.name,
      priceCents: input.priceCents,
      costCents: input.costCents,
      category: input.category,
      updatedAt: new Date(),
    })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .returning();

  if (!product) {
    throw new Error("Product not found.");
  }

  return mapDbProductToProduct(product);
}

export async function archiveProductForTenant(tenantId: string, productId: string): Promise<Product> {
  const [product] = await db
    .update(products)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .returning();

  if (!product) {
    throw new Error("Product not found.");
  }

  return mapDbProductToProduct(product);
}

export async function restoreProductForTenant(tenantId: string, productId: string): Promise<Product> {
  const [product] = await db
    .update(products)
    .set({
      archivedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .returning();

  if (!product) {
    throw new Error("Product not found.");
  }

  return mapDbProductToProduct(product);
}
