import { MAX_QUANTITY, MAX_QUANTITY_LABEL } from "@/lib/inventory";
import {
  formatBs,
  isValidCents,
  MAX_PRICE_CENTS,
  parseBolivianos,
} from "@/lib/money";
import { PRODUCT_NAME_MAX_LENGTH } from "@/lib/products";
import { characterCount } from "@/lib/validation";

export type ProductFormValues = {
  name: string;
  priceCents: number;
  costCents: number | null;
};

export type ProductFormErrors = {
  name?: string;
  price?: string;
  cost?: string;
};

const MAX_PRICE_LABEL = formatBs(MAX_PRICE_CENTS);

/**
 * The editor's name, price and cost as product values, or null values while
 * one is missing or invalid. A blank name or price only keeps Save disabled;
 * anything typed that is not a valid amount gets an error under its field. A
 * blank cost is an unknown cost, never 0.
 */
export function validateProductForm(form: {
  name: string;
  price: string;
  cost: string;
}): { values: ProductFormValues | null; errors: ProductFormErrors } {
  const errors: ProductFormErrors = {};
  const name = form.name.trim();
  if (characterCount(name) > PRODUCT_NAME_MAX_LENGTH) {
    errors.name = `El nombre no puede superar ${PRODUCT_NAME_MAX_LENGTH} caracteres.`;
  }

  const priceCents = form.price.trim() ? parseBolivianos(form.price) : null;
  if (form.price.trim()) {
    if (priceCents == null) {
      errors.price = "Escribe el precio como 15 o 15,50.";
    } else if (priceCents === 0) {
      errors.price = "El precio debe ser mayor que 0.";
    } else if (!isValidCents(priceCents)) {
      errors.price = `El precio no puede superar ${MAX_PRICE_LABEL}.`;
    }
  }

  const costCents = form.cost.trim() ? parseBolivianos(form.cost) : null;
  if (form.cost.trim()) {
    if (costCents == null) {
      errors.cost =
        "Escribe el costo como 8 o 8,50, o déjalo vacío si no lo sabes.";
    } else if (!isValidCents(costCents)) {
      errors.cost = `El costo no puede superar ${MAX_PRICE_LABEL}.`;
    }
  }

  const valid =
    Boolean(name) &&
    priceCents != null &&
    !errors.name &&
    !errors.price &&
    !errors.cost;
  return {
    values: valid ? { name, priceCents, costCents } : null,
    errors,
  };
}

// Stock amounts are whole numbers up to MAX_QUANTITY: a larger count is a
// typo, and Postgres would reject one beyond its integer range.
function parseWholeNumber(value: string, pattern: RegExp) {
  const trimmed = value.trim();
  if (!pattern.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Math.abs(parsed) <= MAX_QUANTITY ? parsed : null;
}

/** Whole integers from 1 to MAX_QUANTITY — rejects decimals and junk. */
export function parsePositiveInteger(value: string) {
  const parsed = parseWholeNumber(value, /^\+?\d+$/);
  return parsed != null && parsed > 0 ? parsed : null;
}

/** Whole integers from 0 to MAX_QUANTITY — rejects negatives and junk. */
export function parseNonNegativeInteger(value: string) {
  return parseWholeNumber(value, /^\+?\d+$/);
}

/** Non-zero whole integers within ±MAX_QUANTITY — rejects decimals and junk. */
export function parseSignedInteger(value: string) {
  const parsed = parseWholeNumber(value, /^(?:\+?\d+|-\d+)$/);
  return parsed != null && parsed !== 0 ? parsed : null;
}

export const INITIAL_STOCK_ERROR = `El stock inicial debe ser un número entero de 0 a ${MAX_QUANTITY_LABEL}, sin decimales.`;

/**
 * Why a typed stock amount cannot be recorded, or null when it is valid,
 * blank, or just a sign typed so far. `signed` is the adjustment field,
 * which also takes negatives.
 */
export function stockAmountError(value: string, signed = false) {
  if (/^[+-]?$/.test(value.trim())) {
    return null;
  }
  if (signed) {
    return parseSignedInteger(value) == null
      ? `Usa un número entero distinto de cero, de -${MAX_QUANTITY_LABEL} a ${MAX_QUANTITY_LABEL}.`
      : null;
  }
  return parsePositiveInteger(value) == null
    ? `Usa un número entero de 1 a ${MAX_QUANTITY_LABEL}, sin decimales ni texto extra.`
    : null;
}
