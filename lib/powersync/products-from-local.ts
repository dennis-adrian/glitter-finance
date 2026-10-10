// Maps the products rows PowerSync replicates into the local SQLite store to
// the Product shape, like the server repository does for Postgres rows
// (lib/products/repository.ts).

import type { LocalRow, products } from "@/lib/db/client-schema";
import { mapDbProductToProduct } from "@/lib/product-mapper";
import type { Product } from "@/lib/types";

export type LocalProductRow = LocalRow<typeof products>;

export function mapLocalProductRow(row: LocalProductRow): Product {
  return mapDbProductToProduct({
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    costCents: row.cost_cents,
    categoryId: row.category_id,
    category: row.category,
    imagePath: row.image_path,
    tracksInventory: row.tracks_inventory,
    lowStockThreshold: row.low_stock_threshold,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
