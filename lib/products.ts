import { UserFacingError } from "@/lib/action-result";
import { MAX_QUANTITY, MAX_QUANTITY_LABEL } from "@/lib/inventory";
import { formatBs, isValidCents, MAX_PRICE_CENTS } from "@/lib/money";
import {
  defaultPlaceholderImageTone,
  encodePlaceholderImagePath,
} from "@/lib/product-image-config";
import { ALL_CATEGORIES } from "@/lib/categories";
import { categoryNameKey } from "@/lib/categories/validation";
import type { Category, Product, ProductInput } from "@/lib/types";
import { characterCount, requireUuid } from "@/lib/validation";

export const emptyProduct: Product = {
  id: "draft",
  name: "Producto",
  priceCents: 0,
  costCents: null,
  categoryId: null,
  category: "",
  imagePath: encodePlaceholderImagePath(defaultPlaceholderImageTone),
  imageUrl: null,
  imageTone: defaultPlaceholderImageTone,
  tracksInventory: false,
  lowStockThreshold: null,
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
};

// Postgres enforces the same lengths (products_name_length_check and
// products_category_length_check in lib/db/schema.ts).
export const PRODUCT_NAME_MAX_LENGTH = 240;
export const PRODUCT_CATEGORY_MAX_LENGTH = 60;

export function getProductInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "P";
}

/**
 * Text as product search compares it: trimmed, lowercase and without accents
 * or other marks, so "lamina" finds "Lámina".
 */
export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export type CategoryIndex = {
  nameById: Map<string, string>;
  idByKey: Map<string, string>;
};

/** A category filter option: a category id, or a fallback key (see
 * productCategoryKey). */
export type CategoryOption = { id: string; label: string };

/** The "all categories" filter option. Its id can't collide with a UUID or
 * a `name:` key. */
export const allCategoriesOption: CategoryOption = {
  id: ALL_CATEGORIES,
  label: ALL_CATEGORIES,
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

/**
 * The products in the category option `categoryKey` (allCategoriesOption.id
 * for every one, see productCategoryKey) whose name contains `query`,
 * ignoring case and accents. Sell and the catalog filter the same way.
 */
export function filterProducts<
  T extends Pick<Product, "name" | "categoryId" | "category">,
>(
  products: T[],
  categoryKey: string,
  query: string,
  index: CategoryIndex
): T[] {
  const search = normalizeSearchText(query);
  return products.filter(
    (product) =>
      (categoryKey === allCategoriesOption.id ||
        productCategoryKey(product, index) === categoryKey) &&
      normalizeSearchText(product.name).includes(search)
  );
}

const INVALID_PRODUCT_MESSAGE = "Los datos del producto no son válidos.";
const MAX_PRICE_LABEL = formatBs(MAX_PRICE_CENTS);

function requiredText(
  value: unknown,
  maxLength: number,
  messages: { blank: string; tooLong: string }
) {
  if (typeof value !== "string") {
    throw new UserFacingError(INVALID_PRODUCT_MESSAGE);
  }
  const text = value.trim();
  if (!text) {
    throw new UserFacingError(messages.blank);
  }
  if (characterCount(text) > maxLength) {
    throw new UserFacingError(messages.tooLong);
  }
  return text;
}

/**
 * A product as it may be stored: a trimmed name within its length, a
 * category id (null leaves an edited product's category as it is), a
 * whole-cent price and optional cost up to MAX_PRICE_CENTS, and a low-stock
 * threshold up to MAX_QUANTITY. (The writers then check that the category is
 * one of the tenant's and store its name next to the id.) The local
 * writers and the server actions both call it, so a value Postgres would
 * reject never reaches the PowerSync upload queue. Optional fields keep their
 * presence, which the update paths rely on. Throws UserFacingError.
 */
export function normalizeProductInput(input: unknown): ProductInput {
  if (!input || typeof input !== "object") {
    throw new UserFacingError(INVALID_PRODUCT_MESSAGE);
  }
  const candidate = input as Record<keyof ProductInput, unknown>;

  const name = requiredText(candidate.name, PRODUCT_NAME_MAX_LENGTH, {
    blank: "El nombre del producto es obligatorio.",
    tooLong: `El nombre del producto no puede superar ${PRODUCT_NAME_MAX_LENGTH} caracteres.`,
  });
  const categoryId =
    candidate.categoryId == null
      ? null
      : requireUuid(candidate.categoryId, "Elegí una categoría válida.");

  if (!isValidCents(candidate.priceCents)) {
    throw new UserFacingError(
      `El precio debe ser un monto de Bs 0 a ${MAX_PRICE_LABEL}.`
    );
  }
  const costCents = candidate.costCents ?? null;
  if (costCents !== null && !isValidCents(costCents)) {
    throw new UserFacingError(
      `El costo debe ser un monto de Bs 0 a ${MAX_PRICE_LABEL}, o quedar vacío.`
    );
  }

  const product: ProductInput = {
    name,
    priceCents: candidate.priceCents,
    costCents,
    categoryId,
  };

  if (candidate.imageTone != null) {
    if (typeof candidate.imageTone !== "string") {
      throw new UserFacingError(INVALID_PRODUCT_MESSAGE);
    }
    product.imageTone = candidate.imageTone;
  }
  if ("imagePath" in candidate) {
    const imagePath = candidate.imagePath ?? null;
    if (imagePath !== null && typeof imagePath !== "string") {
      throw new UserFacingError(INVALID_PRODUCT_MESSAGE);
    }
    product.imagePath = imagePath;
  }
  if ("tracksInventory" in candidate) {
    const tracksInventory = candidate.tracksInventory;
    if (tracksInventory !== undefined && typeof tracksInventory !== "boolean") {
      throw new UserFacingError(INVALID_PRODUCT_MESSAGE);
    }
    product.tracksInventory = tracksInventory;
  }
  if ("lowStockThreshold" in candidate) {
    const threshold = candidate.lowStockThreshold ?? null;
    if (
      threshold !== null &&
      !(
        Number.isInteger(threshold) &&
        Number(threshold) >= 0 &&
        Number(threshold) <= MAX_QUANTITY
      )
    ) {
      throw new UserFacingError(
        `El umbral de stock bajo debe ser un número entero de 0 a ${MAX_QUANTITY_LABEL}.`
      );
    }
    product.lowStockThreshold = threshold as number | null;
  }

  return product;
}
