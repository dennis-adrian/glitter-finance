// No `import "server-only"` here: scripts/seed-qa.ts imports this module
// under plain tsx, where that marker throws (tests/server-only-marker.test.ts).
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { resolveCategoryNameForTenant } from "@/lib/categories/repository";
import { db } from "@/lib/db";
import { inventoryMovements, products } from "@/lib/db/schema";
import {
  normalizeInventoryMovement,
  type InventoryMovement,
} from "@/lib/inventory";
import { mapDbInventoryMovement } from "@/lib/inventory/mapper";
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

type ProductsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The count a product is saved with, recorded as an `initial` movement in the
 * same transaction as the product write, like createProductLocal and
 * updateProductLocal do on a PowerSync device: a failed save leaves neither,
 * so tracking is never switched on without the count it was entered with
 * (stock would then count every earlier sale against the product).
 */
export type InitialStockForTenant = { userId: string; delta: number };

export type SavedProduct = {
  product: Product;
  /** The `initial` movement saved with the product, if it got a count. */
  initialMovement: InventoryMovement | null;
};

/** Checked before the transaction, with the PowerSync writer's rules. */
function prepareInitialStock(initialStock: InitialStockForTenant | undefined) {
  return initialStock
    ? {
        userId: initialStock.userId,
        ...normalizeInventoryMovement({
          delta: initialStock.delta,
          reason: "initial",
        }),
      }
    : null;
}

async function insertInitialStock(
  tx: ProductsTransaction,
  input: {
    tenantId: string;
    productId: string;
    initialStock: NonNullable<ReturnType<typeof prepareInitialStock>>;
    createdAt: Date;
  }
): Promise<InventoryMovement> {
  const [row] = await tx
    .insert(inventoryMovements)
    .values({
      tenantId: input.tenantId,
      productId: input.productId,
      ...input.initialStock,
      createdAt: input.createdAt,
      clientCreatedAt: input.createdAt,
    })
    .returning();

  if (!row) {
    throw new Error("No se pudo registrar el stock inicial.");
  }

  return mapDbInventoryMovement(row);
}

export async function createProductForTenant(
  tenantId: string,
  input: ProductInput,
  initialStock?: InitialStockForTenant
): Promise<SavedProduct> {
  const initial = prepareInitialStock(initialStock);
  // Stamped by this server's clock, like every later update here, instead of
  // Postgres' now(): Postgres keeps a column's newer edit, so an image
  // attached right after the insert would be dropped if this clock ran behind
  // the database's.
  const now = new Date();
  return db.transaction(async (tx) => {
    const category = await resolveCategoryNameForTenant(
      tenantId,
      input.category,
      tx
    );
    const [product] = await tx
      .insert(products)
      .values({
        tenantId,
        name: input.name,
        priceCents: input.priceCents,
        costCents: input.costCents,
        category,
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

    return {
      product: mapDbProductToProduct(product),
      initialMovement: initial
        ? await insertInitialStock(tx, {
            tenantId,
            productId: product.id,
            initialStock: initial,
            createdAt: now,
          })
        : null,
    };
  });
}

export async function updateProductForTenant(
  tenantId: string,
  productId: string,
  input: ProductInput,
  initialStock?: InitialStockForTenant
): Promise<SavedProduct> {
  const initial = prepareInitialStock(initialStock);
  // Every update sets updatedAt: Postgres keeps, column by column, the newer
  // of two edits by it
  // (supabase/manual/20260926130100_products_last_write_wins.sql).
  const updates: {
    name: string;
    priceCents: number;
    costCents: number | null;
    imagePath?: SQL;
    tracksInventory?: boolean;
    lowStockThreshold?: number | null;
    updatedAt: Date;
  } = {
    name: input.name,
    priceCents: input.priceCents,
    costCents: input.costCents,
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

  return db.transaction(async (tx) => {
    // Like updateProductLocal, a category the edit leaves as it was is kept,
    // even when the tenant has no such category (any more): the editor lists
    // it for this product.
    const [current] = await tx
      .select({ category: products.category })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .limit(1);
    const category =
      current?.category === input.category
        ? current.category
        : await resolveCategoryNameForTenant(tenantId, input.category, tx);
    const [product] = await tx
      .update(products)
      .set({ ...updates, category })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .returning();

    if (!product) {
      throw new UserFacingError("No se encontró el producto.");
    }

    return {
      product: mapDbProductToProduct(product),
      initialMovement: initial
        ? await insertInitialStock(tx, {
            tenantId,
            productId: product.id,
            initialStock: initial,
            createdAt: updates.updatedAt,
          })
        : null,
    };
  });
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
