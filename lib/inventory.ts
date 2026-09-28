import { UserFacingError } from "@/lib/action-result";
import { APP_LOCALE } from "@/lib/dates";
import type { inventoryMovementReasonEnum } from "@/lib/db/schema";
import type { Product, Sale } from "@/lib/types";
import { normalizeNote } from "@/lib/validation";

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
 * Most units in one stock movement, sale line or low-stock threshold. Far
 * above any real stall's stock, so a larger count is a typo, and far below
 * the Postgres integer limit, which a typo would otherwise overflow.
 */
export const MAX_QUANTITY = 1_000_000;

export const MAX_QUANTITY_LABEL = new Intl.NumberFormat(APP_LOCALE).format(
  MAX_QUANTITY
);

/**
 * Mirrors inventory_movements_sign_discipline_check in lib/db/schema.ts, plus
 * the MAX_QUANTITY bound. Typed by reason so a new enum value cannot ship
 * without a sign rule and its message.
 */
const MOVEMENT_DELTA_RULES: Record<
  InventoryMovementReason,
  { isValid: (delta: number) => boolean; message: string }
> = {
  initial: {
    isValid: (delta) => delta >= 0,
    message: `El stock inicial debe ser un número entero de 0 a ${MAX_QUANTITY_LABEL}.`,
  },
  restock: {
    isValid: (delta) => delta > 0,
    message: `La cantidad debe ser un número entero de 1 a ${MAX_QUANTITY_LABEL}.`,
  },
  adjustment: {
    isValid: (delta) => delta !== 0,
    message: `El ajuste debe ser un número entero distinto de cero, de -${MAX_QUANTITY_LABEL} a ${MAX_QUANTITY_LABEL}.`,
  },
  loss: {
    isValid: (delta) => delta < 0,
    message: `La cantidad debe ser un número entero de 1 a ${MAX_QUANTITY_LABEL}.`,
  },
  gift: {
    isValid: (delta) => delta < 0,
    message: `La cantidad debe ser un número entero de 1 a ${MAX_QUANTITY_LABEL}.`,
  },
};

/** Whether Postgres would accept this delta for this movement reason. */
export function isValidMovementDelta(
  reason: InventoryMovementReason,
  delta: number
) {
  return (
    Object.hasOwn(MOVEMENT_DELTA_RULES, reason) &&
    Number.isInteger(delta) &&
    Math.abs(delta) <= MAX_QUANTITY &&
    MOVEMENT_DELTA_RULES[reason].isValid(delta)
  );
}

/** What a valid delta for `reason` looks like, for an error message. */
export function movementDeltaError(reason: InventoryMovementReason) {
  return Object.hasOwn(MOVEMENT_DELTA_RULES, reason)
    ? MOVEMENT_DELTA_RULES[reason].message
    : "El tipo de movimiento de inventario no es válido.";
}

/**
 * A movement's delta, reason and note as they may be stored: a delta
 * Postgres accepts for the reason (isValidMovementDelta) and a trimmed note
 * within MAX_NOTE_LENGTH, blank as null. The PowerSync writer and the server
 * action both call it, so the two paths accept the same movements. Throws
 * UserFacingError.
 */
export function normalizeInventoryMovement(input: {
  delta?: unknown;
  reason?: unknown;
  note?: unknown;
}): { delta: number; reason: InventoryMovementReason; note: string | null } {
  const reason = input.reason as InventoryMovementReason;
  if (
    typeof input.reason !== "string" ||
    typeof input.delta !== "number" ||
    !isValidMovementDelta(reason, input.delta)
  ) {
    throw new UserFacingError(movementDeltaError(reason));
  }
  return {
    delta: input.delta,
    reason,
    note: normalizeNote(input.note, "La nota"),
  };
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

/** One product's stock from the part of the ledger an OpeningStock sums. */
export type OpeningStockLevel = {
  productId: string;
  /** Units on hand from the movements and sales recorded before `asOf`. */
  units: number;
  /** The product's latest `initial` movement before `asOf`, if it has one. */
  baseline: { id: string; createdAt: string } | null;
};

/**
 * The ledger before `asOf`, already summed per product on the server
 * (getInventorySnapshotForTenant), so '/' does not send every movement and
 * sale since the tenant started. computeStockByProduct adds the rows from
 * `asOf` on.
 */
export type OpeningStock = {
  asOf: string;
  levels: OpeningStockLevel[];
};

/** What '/' sends for stock: the opening, then the movements after it. */
export type InventorySnapshot = {
  opening: OpeningStock;
  /** The movements recorded from `opening.asOf` on, oldest first. */
  movements: InventoryMovement[];
  /** Whether the tenant has recorded any movement at all. */
  hasMovements: boolean;
};

/** Movements in ledger order: created_at, then id (as the local watch reads them). */
export function compareMovementsOldestFirst(
  a: InventoryMovement,
  b: InventoryMovement
) {
  return (
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * A stored timestamp as epoch ms. Rows written on this device (toISOString,
 * milliseconds) and rows synced from Postgres (microseconds) format the same
 * instant differently, so they are compared as instants, never as strings.
 * An unreadable value sorts first.
 */
function timestampMs(value: string) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

type Baseline = { id: string; atMs: number };

function isLaterBaseline(candidate: Baseline, current: Baseline) {
  if (candidate.atMs !== current.atMs) {
    return candidate.atMs > current.atMs;
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
 *
 * With an `opening`, the rows created before its `asOf` are already summed in
 * it, so they are skipped here. A product's opening units count unless a
 * later `initial` replaced the opening's baseline.
 */
export function computeStockByProduct(
  movements: StockMovement[],
  sales: Sale[],
  opening?: OpeningStock | null
): Map<string, number> {
  const stock = new Map<string, number>();
  const baselineByProduct = new Map<string, Baseline>();
  const openingAtMs = opening
    ? timestampMs(opening.asOf)
    : Number.NEGATIVE_INFINITY;
  const isInOpening = (createdAt: string) =>
    timestampMs(createdAt) < openingAtMs;

  function considerBaseline(productId: string, candidate: Baseline) {
    const current = baselineByProduct.get(productId);
    if (!current || isLaterBaseline(candidate, current)) {
      baselineByProduct.set(productId, candidate);
    }
  }

  for (const level of opening?.levels ?? []) {
    if (level.baseline) {
      considerBaseline(level.productId, {
        id: level.baseline.id,
        atMs: timestampMs(level.baseline.createdAt),
      });
    }
  }

  for (const movement of movements) {
    if (movement.reason !== "initial" || isInOpening(movement.createdAt)) {
      continue;
    }
    considerBaseline(movement.productId, {
      id: movement.id,
      atMs: timestampMs(movement.createdAt),
    });
  }

  for (const level of opening?.levels ?? []) {
    const baseline = baselineByProduct.get(level.productId);
    if (baseline && baseline.id !== level.baseline?.id) {
      continue;
    }
    stock.set(level.productId, (stock.get(level.productId) ?? 0) + level.units);
  }

  for (const movement of movements) {
    if (isInOpening(movement.createdAt)) {
      continue;
    }
    const baseline = baselineByProduct.get(movement.productId);
    if (baseline) {
      const superseded =
        movement.reason === "initial"
          ? movement.id !== baseline.id
          : timestampMs(movement.createdAt) < baseline.atMs;
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
    const saleAtMs = timestampMs(sale.createdAt);
    if (saleAtMs < openingAtMs) {
      continue;
    }
    for (const line of sale.lines) {
      const baseline = baselineByProduct.get(line.productId);
      if (baseline && saleAtMs < baseline.atMs) {
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
  movements: Pick<InventoryMovement, "productId" | "reason">[],
  opening?: OpeningStock | null
) {
  return (
    movements.some(
      (movement) =>
        movement.productId === productId && movement.reason === "initial"
    ) ||
    Boolean(
      opening?.levels.some(
        (level) => level.productId === productId && level.baseline
      )
    )
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
