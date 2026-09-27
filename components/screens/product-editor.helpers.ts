import {
  formatBs,
  isValidCents,
  MAX_PRICE_CENTS,
  parseBolivianos,
} from "@/lib/money";

export type ProductFormValues = {
  name: string;
  priceCents: number;
  costCents: number | null;
};

export type ProductFormErrors = {
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
    Boolean(name) && priceCents != null && !errors.price && !errors.cost;
  return {
    values: valid ? { name, priceCents, costCents } : null,
    errors,
  };
}

/** Whole positive integers only — rejects decimals and trailing junk. */
export function parsePositiveInteger(value: string) {
  const trimmed = value.trim();
  if (!/^\+?\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

/** Whole integers from 0 up — rejects negatives, decimals and trailing junk. */
export function parseNonNegativeInteger(value: string) {
  const trimmed = value.trim();
  if (!/^\+?\d+$/.test(trimmed)) {
    return null;
  }
  return Number.parseInt(trimmed, 10);
}

/** Non-zero whole integers only — rejects decimals and trailing junk. */
export function parseSignedInteger(value: string) {
  const trimmed = value.trim();
  if (!/^(?:\+?\d+|-\d+)$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed !== 0 ? parsed : null;
}
