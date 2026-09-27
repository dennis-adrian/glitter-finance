import type { inventoryMovementReasonEnum } from "@/lib/db/schema";
import type { Product, Sale } from "@/lib/types";

/** Default low-stock threshold when a product has no per-product override. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export type InventoryMovementReason =
  (typeof inventoryMovementReasonEnum.enumValues)[number];

export type InventoryMovement = {
  id: string;
  tenantId: string;
  productId: string;
  userId: string;
  delta: number;
  reason: InventoryMovementReason;
  note: string | null;
  createdAt: string;
  clientCreatedAt: string;
};

export type ProductStockState = "normal" | "low" | "out" | "oversold";

export type ProductStock = {
  remaining: number;
  state: ProductStockState;
};

/**
 * Mirrors inventory_movements_sign_discipline_check in lib/db/schema.ts. Typed
 * by reason so a new enum value cannot ship without a sign rule.
 */
const MOVEMENT_DELTA_RULES: Record<
  InventoryMovementReason,
  (delta: number) => boolean
> = {
  initial: (delta) => delta >= 0,
  restock: (delta) => delta > 0,
  adjustment: (delta) => delta !== 0,
  loss: (delta) => delta < 0,
  gift: (delta) => delta < 0,
};

/** Whether Postgres would accept this delta for this movement reason. */
export function isValidMovementDelta(
  reason: InventoryMovementReason,
  delta: number
) {
  return Number.isInteger(delta) && MOVEMENT_DELTA_RULES[reason](delta);
}

/**
 * The `initial` delta to record when a product is saved, or null for none.
 *
 * Stock counts from the product's latest `initial` (see computeStockByProduct),
 * so switching tracking on always records one — the entered count, or 0 when
 * the field is left blank — and sales made before tracking started never count
 * against the new stock. A product that already tracks stock but has no
 * `initial` gets one only when a count is entered: writing 0 there would
 * silently discard restocks recorded without a baseline.
 */
export function resolveInitialStockDelta(input: {
  tracksInventory: boolean;
  wasTrackingInventory: boolean;
  hasInitialMovement: boolean;
  initialStock?: number;
}): number | null {
  if (!input.tracksInventory || input.hasInitialMovement) {
    return null;
  }
  if (input.initialStock != null) {
    return input.initialStock;
  }
  return input.wasTrackingInventory ? null : 0;
}

type StockMovement = Pick<
  InventoryMovement,
  "id" | "productId" | "delta" | "reason" | "createdAt"
>;

function isLaterMovement(candidate: StockMovement, current: StockMovement) {
  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt > current.createdAt;
  }
  return candidate.id > current.id;
}

/**
 * Derive on-hand units per product from the append-only movement ledger and
 * completed sale lines (voids excluded; refunds add units back).
 *
 * An `initial` movement is a stock count, so it is the product's baseline:
 * only the latest `initial` counts, and movements and sales before it are
 * ignored. Several `initial` rows are legal (two devices can each record one
 * while offline); every device converges on the latest, with ties broken by id.
 */
export function computeStockByProduct(
  movements: StockMovement[],
  sales: Sale[]
): Map<string, number> {
  const stock = new Map<string, number>();
  const baselineByProduct = new Map<string, StockMovement>();

  for (const movement of movements) {
    if (movement.reason !== "initial") {
      continue;
    }
    const current = baselineByProduct.get(movement.productId);
    if (!current || isLaterMovement(movement, current)) {
      baselineByProduct.set(movement.productId, movement);
    }
  }

  for (const movement of movements) {
    const baseline = baselineByProduct.get(movement.productId);
    if (baseline) {
      const superseded =
        movement.reason === "initial"
          ? movement.id !== baseline.id
          : movement.createdAt < baseline.createdAt;
      if (superseded) {
        continue;
      }
    }
    stock.set(
      movement.productId,
      (stock.get(movement.productId) ?? 0) + movement.delta
    );
  }

  for (const sale of sales) {
    if (sale.status === "voided") {
      continue;
    }
    const sign = sale.refundOfSaleId ? -1 : 1;
    for (const line of sale.lines) {
      const baseline = baselineByProduct.get(line.productId);
      if (baseline && sale.createdAt < baseline.createdAt) {
        continue;
      }
      stock.set(
        line.productId,
        (stock.get(line.productId) ?? 0) - line.quantity * sign
      );
    }
  }

  return stock;
}

export function productHasInitialMovement(
  productId: string,
  movements: Pick<InventoryMovement, "productId" | "reason">[]
) {
  return movements.some(
    (movement) =>
      movement.productId === productId && movement.reason === "initial"
  );
}

export function getProductStock(
  product: Pick<Product, "id" | "tracksInventory" | "lowStockThreshold">,
  stockByProduct: Map<string, number>
): ProductStock | null {
  if (!product.tracksInventory) {
    return null;
  }

  const remaining = stockByProduct.get(product.id) ?? 0;
  const threshold = product.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  if (remaining < 0) {
    return { remaining, state: "oversold" };
  }
  if (remaining === 0) {
    return { remaining, state: "out" };
  }
  if (remaining <= threshold) {
    return { remaining, state: "low" };
  }
  return { remaining, state: "normal" };
}

export function computeTrackedProductStock(
  products: Product[],
  stockByProduct: Map<string, number>
) {
  return products.flatMap((product) => {
    const stock = getProductStock(product, stockByProduct);
    return stock ? [{ product, stock }] : [];
  });
}

// Single source of truth for how stock is labelled across the tile, catalog
// card, editor, and reports, so the surfaces stay consistent.

const STOCK_STATE_WORD: Record<ProductStockState, string> = {
  normal: "disponible",
  low: "stock bajo",
  out: "agotado",
  oversold: "sobreventa",
};

// Lower number = more urgent; used to surface actionable stock first in reports.
const STOCK_STATE_SEVERITY: Record<ProductStockState, number> = {
  oversold: 0,
  out: 1,
  low: 2,
  normal: 3,
};

/** Numeric remaining with sign: "−3" | "0" | "12". */
export function stockValueLabel(stock: ProductStock): string {
  return stock.state === "oversold"
    ? `−${Math.abs(stock.remaining)}`
    : String(stock.remaining);
}

/** Compact badge text for tiles and catalog cards: "agotado" | "−3" | "12". */
export function stockBadgeLabel(stock: ProductStock): string {
  return stock.state === "out" ? "agotado" : stockValueLabel(stock);
}

/** State word for secondary text: "disponible" | "stock bajo" | … */
export function stockStateWord(stock: ProductStock): string {
  return STOCK_STATE_WORD[stock.state];
}

/** Screen-reader label, since the badge is otherwise color- or sign-only. */
export function stockAriaLabel(stock: ProductStock): string {
  if (stock.state === "out") return "Inventario: agotado";
  if (stock.state === "oversold") {
    return `Inventario: sobreventa, ${Math.abs(stock.remaining)} por debajo de cero`;
  }
  if (stock.state === "low") {
    return `Inventario: stock bajo, ${stock.remaining} en mano`;
  }
  return `Inventario: ${stock.remaining} en mano`;
}

/** True for states shown with a warning glyph (not distinguishable by color alone). */
export function stockNeedsGlyph(state: ProductStockState): boolean {
  return state === "low" || state === "oversold";
}

/** Sort comparator: most urgent state first. */
export function compareStockSeverity(
  a: ProductStockState,
  b: ProductStockState
): number {
  return STOCK_STATE_SEVERITY[a] - STOCK_STATE_SEVERITY[b];
}
