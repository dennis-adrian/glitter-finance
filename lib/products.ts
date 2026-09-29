import type { Product } from "@/lib/types";

export const emptyProduct: Product = {
  id: "draft",
  name: "Producto",
  priceCents: 0,
  costCents: null,
  category: "Stickers",
  imagePath: "placeholder:violet",
  imageUrl: null,
  imageTone: "violet",
  tracksInventory: false,
  lowStockThreshold: null,
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
};

export function getProductInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "P";
}

/**
 * Category names (in the given order) that at least one product uses, so
 * filter chips never lead to an empty grid.
 */
export function categoriesInUse(
  names: string[],
  products: Pick<Product, "category">[]
) {
  const used = new Set(products.map((product) => product.category));
  return names.filter((name) => used.has(name));
}
