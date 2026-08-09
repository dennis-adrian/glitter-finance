import type { Product, Sale } from "@/lib/types";

/** Default low-stock threshold when a product has no per-product override. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export type InventoryMovementReason =
  | "initial"
  | "restock"
  | "adjustment"
  | "loss"
  | "gift";

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
 * Derive on-hand units per product from the append-only movement ledger and
 * completed sale lines (voids excluded; refunds add units back).
 */
export function computeStockByProduct(
  movements: Pick<
    InventoryMovement,
    "productId" | "delta" | "reason" | "createdAt"
  >[],
  sales: Sale[]
): Map<string, number> {
  const stock = new Map<string, number>();
  const trackingBaselineByProduct = new Map<string, string>();

  for (const movement of movements) {
    if (movement.reason !== "initial") {
      continue;
    }
    const previousBaseline = trackingBaselineByProduct.get(movement.productId);
    if (!previousBaseline || movement.createdAt > previousBaseline) {
      trackingBaselineByProduct.set(movement.productId, movement.createdAt);
    }
  }

  for (const movement of movements) {
    const baseline = trackingBaselineByProduct.get(movement.productId);
    if (baseline && movement.createdAt < baseline) {
      continue;
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
      if (!line.productId) {
        continue;
      }
      const baseline = trackingBaselineByProduct.get(line.productId);
      if (baseline && sale.createdAt < baseline) {
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
