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

export const CATEGORY_MAX_LENGTH = 40;

/** Comparison key: ignores case, accents, and surrounding spaces. */
export function categoryKey(category: string) {
  return category
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es");
}

export function isSameCategory(a: string, b: string) {
  return categoryKey(a) === categoryKey(b);
}

/**
 * Vendor-defined categories: every distinct category in use, sorted for
 * Spanish and deduplicated ignoring case and accents (first spelling wins).
 */
export function deriveCategories(products: Pick<Product, "category">[]) {
  const byKey = new Map<string, string>();
  for (const product of products) {
    const name = product.category.trim();
    if (!name) continue;
    const key = categoryKey(name);
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}

/**
 * Normalizes a typed category (collapses spaces, trims, caps length) and
 * reuses an existing category's spelling when it matches ignoring case and
 * accents, so "llaveros" joins "Llaveros" instead of creating a duplicate.
 */
export function resolveCategoryName(input: string, existing: string[]) {
  const cleaned = input
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CATEGORY_MAX_LENGTH);
  return (
    existing.find((category) => isSameCategory(category, cleaned)) ?? cleaned
  );
}
