import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { mapDbProductToProduct } from "@/lib/product-mapper";
import {
  encodePlaceholderImagePath,
  isPlaceholderImagePath,
  placeholderImagePathPattern,
} from "@/lib/product-image-config";
import type { Product, ProductInput } from "@/lib/types";

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

export async function findProductForTenant(
  tenantId: string,
  productId: string
): Promise<Product | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .limit(1);

  return product ? mapDbProductToProduct(product) : null;
}

export async function createProductForTenant(
  tenantId: string,
  input: ProductInput
): Promise<Product> {
  // Stamped by this server's clock, like every later update here, instead of
  // Postgres' now(): Postgres keeps a column's newer edit, so an image
  // attached right after the insert would be dropped if this clock ran behind
  // the database's.
  const now = new Date();
  const [product] = await db
    .insert(products)
    .values({
      tenantId,
      name: input.name,
      priceCents: input.priceCents,
      costCents: input.costCents,
      category: input.category,
      // A new product starts with a placeholder. An image is attached after
      // the insert, by updateProductImageForTenant.
      imagePath: encodePlaceholderImagePath(input.imageTone),
      tracksInventory: input.tracksInventory ?? false,
      lowStockThreshold: input.lowStockThreshold ?? null,
      createdAt: now,
      updatedAt: now,
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
  // Every update sets updatedAt: Postgres keeps, column by column, the newer
  // of two edits by it
  // (supabase/manual/20260926130100_products_last_write_wins.sql).
  const updates: {
    name: string;
    priceCents: number;
    costCents: number | null;
    category: string;
    imagePath?: SQL;
    tracksInventory?: boolean;
    lowStockThreshold?: number | null;
    updatedAt: Date;
  } = {
    name: input.name,
    priceCents: input.priceCents,
    costCents: input.costCents,
    category: input.category,
    updatedAt: new Date(),
  };

  // Same rule as updateProductLocal: the editor only picks a placeholder
  // tone, which applies while the row still shows a placeholder. Uploaded
  // images change only through updateProductImageForTenant, so an editor
  // opened before another device replaced the image cannot restore the old,
  // deleted one. Postgres also keeps an uploaded image over a placeholder,
  // whoever writes it (products_keep_latest_edit).
  if (isPlaceholderImagePath(input.imagePath)) {
    updates.imagePath = sql`CASE
      WHEN ${products.imagePath} IS NULL
        OR ${products.imagePath} LIKE ${placeholderImagePathPattern}
        THEN ${encodePlaceholderImagePath(input.imageTone)}
      ELSE ${products.imagePath}
    END`;
  }

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
    throw new UserFacingError("No se encontró el producto.");
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
    throw new UserFacingError("No se encontró el producto.");
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
    throw new UserFacingError("No se encontró el producto.");
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
    throw new UserFacingError("No se encontró el producto.");
  }

  return mapDbProductToProduct(product);
}
