import { UserFacingError } from "@/lib/action-result";
import { MAX_QUANTITY, MAX_QUANTITY_LABEL } from "@/lib/inventory";
import { formatBs, isValidCents, MAX_PRICE_CENTS } from "@/lib/money";
import {
  defaultPlaceholderImageTone,
  encodePlaceholderImagePath,
} from "@/lib/product-image-config";
import { canonicalizeCategory } from "@/lib/categories";
import type { Product, ProductInput } from "@/lib/types";
import { characterCount } from "@/lib/validation";

export const emptyProduct: Product = {
  id: "draft",
  name: "Producto",
  priceCents: 0,
  costCents: null,
  category: "Stickers",
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
export const PRODUCT_NAME_MAX_LENGTH = 120;
export const PRODUCT_CATEGORY_MAX_LENGTH = 60;

export function getProductInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "P";
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
 * A product as it may be stored: a trimmed name and category (in its current
 * spelling) within their lengths, a whole-cent price and optional cost up to
 * MAX_PRICE_CENTS, and a low-stock threshold up to MAX_QUANTITY. The local
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
  const category = canonicalizeCategory(
    requiredText(candidate.category, PRODUCT_CATEGORY_MAX_LENGTH, {
      blank: "La categoría del producto es obligatoria.",
      tooLong: `La categoría no puede superar ${PRODUCT_CATEGORY_MAX_LENGTH} caracteres.`,
    })
  );

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
    category,
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
