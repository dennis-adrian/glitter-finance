import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, products } from "@/lib/db/schema";
import { postgresErrorCode } from "@/lib/db/errors";
import {
  encodePlaceholderImagePath,
  mapDbProductToProduct,
} from "@/lib/product-mapper";
import { isPlaceholderImagePath } from "@/lib/product-image-config";
import {
  findCategoryByNameForTenant,
  getCategoryForTenant,
} from "@/lib/categories/repository";
import type { Product, ProductInput } from "@/lib/types";

/**
 * Product payload from the client. Tabs opened before categories were linked
 * by id can still call these actions with the category name instead.
 */
export type ProductPayload = Omit<ProductInput, "categoryId"> & {
  categoryId?: string | null;
  category?: string;
};

function resolveInputImagePath(input: ProductPayload) {
  if (isPlaceholderImagePath(input.imagePath)) {
    return encodePlaceholderImagePath(input.imageTone);
  }

  return input.imagePath;
}

function resolvePayloadCategory(tenantId: string, input: ProductPayload) {
  if (!input.categoryId && input.category !== undefined) {
    return findCategoryByNameForTenant(tenantId, input.category);
  }
  return getCategoryForTenant(tenantId, input.categoryId);
}

function invalidCategoryError(error: unknown): never {
  const code = postgresErrorCode(error);
  if (code === "23503" || code === "22P02") {
    throw new Error("Seleccioná una categoría válida.");
  }
  throw error;
}

export async function getProductsForTenant(
  tenantId: string
): Promise<Product[]> {
  const rows = await db
    .select({
      ...getTableColumns(products),
      // Derived name, in case the row hasn't been re-synced after a rename.
      category: sql<string>`coalesce(${categories.name}, ${products.category})`,
    })
    .from(products)
    .leftJoin(
      categories,
      and(
        eq(categories.id, products.categoryId),
        eq(categories.tenantId, products.tenantId)
      )
    )
    .where(eq(products.tenantId, tenantId))
    .orderBy(asc(products.archivedAt), asc(products.name));

  return rows.map(mapDbProductToProduct);
}

export async function createProductForTenant(
  tenantId: string,
  input: ProductPayload
): Promise<Product> {
  const category = await resolvePayloadCategory(tenantId, input);
  try {
    const [product] = await db
      .insert(products)
      .values({
        tenantId,
        name: input.name,
        priceCents: input.priceCents,
        costCents: input.costCents,
        categoryId: category.id,
        category: category.name,
        imagePath: resolveInputImagePath(input),
        tracksInventory: input.tracksInventory ?? false,
        lowStockThreshold: input.lowStockThreshold ?? null,
      })
      .returning();

    if (!product) {
      throw new Error("No se pudo crear el producto.");
    }

    return mapDbProductToProduct(product);
  } catch (error) {
    return invalidCategoryError(error);
  }
}

export async function updateProductForTenant(
  tenantId: string,
  productId: string,
  input: ProductPayload
): Promise<Product> {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
        .limit(1);

      if (!current) {
        throw new Error("No se encontró el producto.");
      }

      const updates: {
        name: string;
        priceCents: number;
        costCents: number | null;
        categoryId?: string;
        category?: string;
        imagePath: string | null;
        tracksInventory?: boolean;
        lowStockThreshold?: number | null;
        updatedAt: Date;
      } = {
        name: input.name,
        priceCents: input.priceCents,
        costCents: input.costCents,
        imagePath: resolveInputImagePath(input) ?? null,
        updatedAt: new Date(),
      };

      // Category columns are written only when the category changes.
      const changesCategory = input.categoryId
        ? input.categoryId !== current.categoryId
        : input.category !== undefined;
      if (changesCategory) {
        const category = await resolvePayloadCategory(tenantId, input);
        if (category.id !== current.categoryId) {
          updates.categoryId = category.id;
          updates.category = category.name;
        }
      }

      if ("tracksInventory" in input) {
        updates.tracksInventory = input.tracksInventory ?? false;
      }
      if ("lowStockThreshold" in input) {
        updates.lowStockThreshold = input.lowStockThreshold ?? null;
      }

      const [product] = await tx
        .update(products)
        .set(updates)
        .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
        .returning();

      if (!product) {
        throw new Error("No se encontró el producto.");
      }

      return mapDbProductToProduct(product);
    });
  } catch (error) {
    return invalidCategoryError(error);
  }
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
