// Sale pricing, shared by every checkout path: the cart and payment screens,
// the PowerSync writer (lib/powersync/write-sales.ts) and the server action
// (lib/sales/repository.ts), so a sale is priced the same way whichever path
// records it.
//
// Postgres checks the result rather than computing it. powersync_create_sale
// (supabase/manual/20260926120000_powersync_upload_convergence.sql) and the
// sale_lines CHECK constraints in lib/db/schema.ts reject a line whose
// discount is above its gross or whose total is not gross − discount, and a
// sale discount above the sum of the line totals. Change them together.

import { UserFacingError } from "@/lib/action-result";
import { MAX_QUANTITY, MAX_QUANTITY_LABEL } from "@/lib/inventory";
import { clampDiscount, INT4_MAX, isValidCents } from "@/lib/money";
import { canonicalizeCategory } from "@/lib/categories";
import type { Product } from "@/lib/types";
import { normalizeNote } from "@/lib/validation";

/**
 * Largest line gross and sale subtotal: the line amounts and the sale
 * discount are Postgres integer columns.
 */
export const MAX_SALE_TOTAL_CENTS = INT4_MAX;

/** Most distinct products in one sale. */
export const MAX_SALE_LINES = 200;

export type SaleLineRequest = {
  productId: string;
  quantity: number;
  lineDiscountCents?: number;
  lineDiscountReason?: string | null;
};

export type SaleRequest = {
  lines: SaleLineRequest[];
  saleDiscountCents: number;
  saleDiscountReason?: string | null;
};

/** A product as the app or the database row holds it. */
export type PricingProduct = Pick<
  Product,
  "id" | "name" | "category" | "priceCents" | "costCents"
> & { archivedAt: Date | string | null };

/** A sale line with the price and cost snapshotted from its product. */
export type PricedSaleLine = {
  productId: string;
  productName: string;
  category: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number | null;
  lineDiscountCents: number;
  lineDiscountReason: string | null;
  lineTotalCents: number;
};

export type PricedSale = {
  lines: PricedSaleLine[];
  /** Sum of the line totals, which the sale discount applies to. */
  subtotalCents: number;
  saleDiscountCents: number;
  saleDiscountReason: string | null;
  /** What the customer pays. */
  totalCents: number;
};

type PricingLine = {
  priceCents: number;
  quantity: number;
  lineDiscountCents?: number;
};

/** A line's gross, its discount clamped to that gross, and what is left. */
export function priceLine(line: PricingLine) {
  const grossCents = line.priceCents * line.quantity;
  const discountCents = clampDiscount(line.lineDiscountCents ?? 0, grossCents);
  return { grossCents, discountCents, totalCents: grossCents - discountCents };
}

/** Sum of the line totals after their own discounts. */
export function linesSubtotalCents(lines: PricingLine[]) {
  return lines.reduce((total, line) => total + priceLine(line).totalCents, 0);
}

/** The cart's subtotal, from each line's product price. */
export function cartSubtotalCents(
  lines: {
    product: Pick<Product, "priceCents">;
    quantity: number;
    lineDiscountCents?: number;
  }[]
) {
  return linesSubtotalCents(
    lines.map((line) => ({
      priceCents: line.product.priceCents,
      quantity: line.quantity,
      lineDiscountCents: line.lineDiscountCents,
    }))
  );
}

/** What the customer pays once the sale discount is taken off. */
export function saleTotalCents(
  subtotalCents: number,
  saleDiscountCents: number
) {
  return subtotalCents - clampDiscount(saleDiscountCents, subtotalCents);
}

/** Whether `subtotalCents` can be recorded as one sale. */
export function isWithinSaleLimit(subtotalCents: number) {
  return isValidCents(subtotalCents, MAX_SALE_TOTAL_CENTS);
}

const QUANTITY_MESSAGE = `Las cantidades deben ser números enteros de 1 a ${MAX_QUANTITY_LABEL}.`;
const DISCOUNT_MESSAGE = "Los descuentos deben ser montos válidos.";

// Discounts arrive as whole cents from parseDiscountInput; anything else is a
// bug, and silently dropping it would charge more than the vendor agreed.
function isDiscountCents(value: unknown) {
  return isValidCents(value, Number.MAX_SAFE_INTEGER);
}

/**
 * Checks each line and combines lines for the same product: quantities and
 * discounts add up, and the first non-blank reason is kept.
 */
export function mergeSaleLines(lines: SaleLineRequest[]): SaleLineRequest[] {
  if (lines.length === 0) {
    throw new UserFacingError("La venta necesita al menos un producto.");
  }

  const byProduct = new Map<string, SaleLineRequest>();
  for (const line of lines) {
    if (typeof line.productId !== "string" || !line.productId) {
      throw new UserFacingError("Cada línea de venta necesita un producto.");
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new UserFacingError(QUANTITY_MESSAGE);
    }
    const lineDiscountCents = line.lineDiscountCents ?? 0;
    if (!isDiscountCents(lineDiscountCents)) {
      throw new UserFacingError(DISCOUNT_MESSAGE);
    }
    const reason = normalizeNote(line.lineDiscountReason, "El motivo");

    const existing = byProduct.get(line.productId);
    const quantity = (existing?.quantity ?? 0) + line.quantity;
    if (quantity > MAX_QUANTITY) {
      throw new UserFacingError(QUANTITY_MESSAGE);
    }
    byProduct.set(line.productId, {
      productId: line.productId,
      quantity,
      lineDiscountCents: (existing?.lineDiscountCents ?? 0) + lineDiscountCents,
      lineDiscountReason: existing?.lineDiscountReason ?? reason,
    });
  }

  if (byProduct.size > MAX_SALE_LINES) {
    throw new UserFacingError(
      `Una venta puede tener hasta ${MAX_SALE_LINES} productos distintos.`
    );
  }
  return [...byProduct.values()];
}

/**
 * Prices a sale from its products: snapshots name, category (in its current
 * spelling), price and cost, clamps each line discount to its line and the
 * sale discount to the subtotal, and computes every total. Throws
 * UserFacingError for anything Postgres would reject, so an invalid sale is
 * never written.
 */
export function priceSale(
  request: SaleRequest,
  productById: ReadonlyMap<string, PricingProduct>
): PricedSale {
  if (!isDiscountCents(request.saleDiscountCents)) {
    throw new UserFacingError(DISCOUNT_MESSAGE);
  }
  const saleDiscountReason = normalizeNote(
    request.saleDiscountReason,
    "El motivo"
  );

  const lines = mergeSaleLines(request.lines).map((line): PricedSaleLine => {
    const product = productById.get(line.productId);
    if (!product) {
      throw new UserFacingError("Uno o más productos ya no están disponibles.");
    }
    if (product.archivedAt) {
      throw new UserFacingError(
        "Uno o más productos están archivados y no se pueden vender."
      );
    }
    if (
      !isValidCents(product.priceCents, INT4_MAX) ||
      (product.costCents != null && !isValidCents(product.costCents, INT4_MAX))
    ) {
      throw new UserFacingError(
        `El precio o el costo de ${product.name} no es válido. Edita el producto antes de venderlo.`
      );
    }

    const { grossCents, discountCents, totalCents } = priceLine({
      priceCents: product.priceCents,
      quantity: line.quantity,
      lineDiscountCents: line.lineDiscountCents,
    });
    if (grossCents > MAX_SALE_TOTAL_CENTS) {
      throw new UserFacingError(
        `El total de ${product.name} supera el máximo que se puede registrar.`
      );
    }

    return {
      productId: product.id,
      productName: product.name,
      category: canonicalizeCategory(product.category),
      quantity: line.quantity,
      unitPriceCents: product.priceCents,
      unitCostCents: product.costCents,
      lineDiscountCents: discountCents,
      lineDiscountReason: line.lineDiscountReason ?? null,
      lineTotalCents: totalCents,
    };
  });

  const subtotalCents = lines.reduce(
    (total, line) => total + line.lineTotalCents,
    0
  );
  if (!isWithinSaleLimit(subtotalCents)) {
    throw new UserFacingError(
      "El total de la venta supera el máximo que se puede registrar."
    );
  }
  const saleDiscountCents = clampDiscount(
    request.saleDiscountCents,
    subtotalCents
  );

  return {
    lines,
    subtotalCents,
    saleDiscountCents,
    saleDiscountReason,
    totalCents: subtotalCents - saleDiscountCents,
  };
}
