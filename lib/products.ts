import { categoryNameKey } from "@/lib/categories/validation";
import type { Category, Product } from "@/lib/types";

export const emptyProduct: Product = {
  id: "draft",
  name: "Producto",
  priceCents: 0,
  costCents: null,
  categoryId: null,
  category: "",
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

export type CategoryIndex = {
  nameById: Map<string, string>;
  idByKey: Map<string, string>;
};

export type CategoryOption = { id: string; label: string };

/** The "all categories" filter option. Its id can't collide with a UUID or
 * a `name:` key. */
export const allCategoriesOption: CategoryOption = {
  id: "Todos",
  label: "Todos",
};

export function categoryIndex(
  categories: Pick<Category, "id" | "name">[]
): CategoryIndex {
  const nameById = new Map<string, string>();
  const idByKey = new Map<string, string>();
  for (const category of categories) {
    nameById.set(category.id, category.name);
    const key = categoryNameKey(category.name);
    if (!idByKey.has(key)) idByKey.set(key, category.id);
  }
  return { nameById, idByKey };
}

/**
 * The product's category id. Rows written by old clients may not be linked
 * yet (the server links them on its next write), so fall back to the
 * category with the same name.
 */
export function effectiveCategoryId(
  product: Pick<Product, "categoryId" | "category">,
  index: CategoryIndex
) {
  return (
    product.categoryId ??
    index.idByKey.get(categoryNameKey(product.category)) ??
    null
  );
}

/**
 * Stable filter key for the product's category: its id, or its name when the
 * category isn't available locally (e.g. before categories finish syncing).
 */
export function productCategoryKey(
  product: Pick<Product, "categoryId" | "category">,
  index: CategoryIndex
) {
  return (
    effectiveCategoryId(product, index) ??
    `name:${categoryNameKey(product.category)}`
  );
}

export function categoryLabel(
  product: Pick<Product, "categoryId" | "category">,
  index: CategoryIndex
) {
  return (
    (product.categoryId ? index.nameById.get(product.categoryId) : undefined) ??
    product.category
  );
}

/**
 * Filter options for the given categories (in order), plus one fallback
 * option per product whose category isn't available locally.
 */
export function categoryOptions(
  categories: Pick<Category, "id" | "name">[],
  products: Pick<Product, "categoryId" | "category">[],
  index: CategoryIndex
): CategoryOption[] {
  const options: CategoryOption[] = categories.map((category) => ({
    id: category.id,
    label: category.name,
  }));
  const seen = new Set(options.map((option) => option.id));
  for (const product of products) {
    const key = productCategoryKey(product, index);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ id: key, label: product.category });
  }
  return options;
}

/**
 * Options (in the given order) that at least one product uses, so filter
 * chips never lead to an empty grid.
 */
export function categoriesInUse(
  options: CategoryOption[],
  products: Pick<Product, "categoryId" | "category">[],
  index: CategoryIndex
) {
  const used = new Set(
    products.map((product) => productCategoryKey(product, index))
  );
  return options.filter((option) => used.has(option.id));
}
