import { formatBs } from "@/lib/money";
import type { PaymentMethod, Sale } from "@/lib/types";

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  qr_transfer: "QR",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && Object.hasOwn(paymentLabels, value);
}

// The void window. Postgres enforces the same numbers in powersync_void_sale
// and the sales_void_transition trigger
// (supabase/manual/20260926120000_powersync_upload_convergence.sql); change
// both together.
export const VOID_WINDOW_MINUTES = 10;
export const VOID_WINDOW_MS = VOID_WINDOW_MINUTES * 60 * 1000;
/**
 * How far a sale's createdAt may be ahead of the voiding clock. createdAt comes
 * from the clock of the device that recorded the sale, which can run slightly
 * ahead of the device that voids it.
 */
export const VOID_CLOCK_SKEW_TOLERANCE_MS = 5_000;
export const VOID_WINDOW_EXPIRED_MESSAGE = `Las ventas solo se pueden anular dentro de los primeros ${VOID_WINDOW_MINUTES} minutos.`;

// Why a void or refund was refused. The screens, the PowerSync writers and
// the server repository give the same reasons.
export const SALE_ALREADY_VOIDED_MESSAGE = "Esta venta ya fue anulada.";
export const SALE_ALREADY_REFUNDED_MESSAGE = "Esta venta ya fue reembolsada.";
export const REFUNDED_SALE_VOID_MESSAGE =
  "No se puede anular una venta reembolsada.";
export const VOIDED_SALE_REFUND_MESSAGE =
  "No se puede reembolsar una venta anulada.";

/** Whether a sale recorded at `createdAt` can still be voided at `now`. */
export function isWithinVoidWindow(createdAt: string | Date, now: number) {
  const createdAtMs = new Date(createdAt).getTime();

  return (
    !Number.isNaN(createdAtMs) &&
    createdAtMs - now <= VOID_CLOCK_SKEW_TOLERANCE_MS &&
    now - createdAtMs <= VOID_WINDOW_MS
  );
}

export function saleGrossCents(sale: Sale) {
  return sale.lines.reduce(
    (total, line) => total + line.unitPriceCents * line.quantity,
    0
  );
}

export function saleLineDiscountCents(sale: Sale) {
  return sale.lines.reduce((total, line) => total + line.lineDiscountCents, 0);
}

export function saleDiscountTotalCents(sale: Sale) {
  return sale.saleDiscountCents + saleLineDiscountCents(sale);
}

export function saleLineTotalCents(sale: Sale) {
  return sale.lines.reduce((total, line) => total + line.lineTotalCents, 0);
}

export function saleCostCents(sale: Sale) {
  return sale.lines.reduce(
    (total, line) => total + (line.unitCostCents ?? 0) * line.quantity,
    0
  );
}

export function saleHasUnknownCost(sale: Sale) {
  return sale.lines.some((line) => line.unitCostCents == null);
}

/**
 * The part of the sale discount taken off the line totals: all of it, except
 * that a sale is never charged below zero.
 */
export function saleAppliedDiscountCents(sale: Sale) {
  return Math.min(
    Math.max(0, sale.saleDiscountCents),
    saleLineTotalCents(sale)
  );
}

/** What the customer paid, as a positive amount even on a refund record. */
function saleChargedCents(sale: Sale) {
  return saleLineTotalCents(sale) - saleAppliedDiscountCents(sale);
}

/**
 * An amount of `sale` with its sign in reports: a refund record takes its
 * amounts back. `0 - amount` rather than `-amount`, so a zero stays 0 and
 * never formats as "-0".
 */
function signed(sale: Sale, amount: number) {
  return sale.refundOfSaleId ? 0 - amount : amount;
}

export function saleNetCents(sale: Sale) {
  return signed(sale, saleChargedCents(sale));
}

export function saleProfitCents(sale: Sale) {
  return signed(sale, saleChargedCents(sale) - saleCostCents(sale));
}

export function saleTotal(sale: Sale) {
  return formatBs(saleNetCents(sale), true);
}

/**
 * Splits `amount` across `weights` in proportion to each weight, in whole
 * cents. Each share is rounded down and the cents left over go, one each, to
 * the shares with the largest remainders (the earlier one on a tie), so the
 * shares always add up to `amount`.
 */
export function allocateProportionally(
  amount: number,
  weights: readonly number[]
): number[] {
  const parts = weights.map((weight) => Math.max(0, weight));
  const total = parts.reduce((sum, weight) => sum + weight, 0);
  if (amount <= 0 || total <= 0) {
    return parts.map(() => 0);
  }

  // amount × weight can pass 2^53 on large sales, so it is exact in BigInt.
  const bigAmount = BigInt(amount);
  const bigTotal = BigInt(total);
  const shares = parts.map((weight, index) => {
    const product = bigAmount * BigInt(weight);
    return {
      index,
      cents: Number(product / bigTotal),
      remainder: product % bigTotal,
    };
  });

  let leftover = amount - shares.reduce((sum, share) => sum + share.cents, 0);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1
  );
  for (const share of byRemainder) {
    if (leftover <= 0) break;
    share.cents += 1;
    leftover -= 1;
  }

  return shares.map((share) => share.cents);
}

/**
 * What each line brought in, signed like saleNetCents: its total after its
 * own discount, less its part of the sale discount, which is split across
 * the lines in proportion to their totals. The lines add up to
 * saleNetCents(sale) exactly, so per-category and per-product figures add
 * up to the net revenue.
 */
export function saleLineNetCents(sale: Sale): number[] {
  const discounts = allocateProportionally(
    saleAppliedDiscountCents(sale),
    sale.lines.map((line) => line.lineTotalCents)
  );
  return sale.lines.map((line, index) =>
    signed(sale, line.lineTotalCents - discounts[index])
  );
}

/** Voided sales never happened as far as reports go. */
function accountableSales(sales: Sale[]) {
  return sales.filter((sale) => sale.status !== "voided");
}

/**
 * A list of sales indexed once, so per-row checks (a sale's status, whether
 * it can still be voided or refunded) look sales up instead of scanning the
 * whole list for every row.
 */
export type SaleIndex = {
  byId: ReadonlyMap<string, Sale>;
  /** The refund record of each refunded sale, by the refunded sale's id. */
  refundBySaleId: ReadonlyMap<string, Sale>;
};

export function indexSales(sales: readonly Sale[]): SaleIndex {
  const byId = new Map<string, Sale>();
  const refundBySaleId = new Map<string, Sale>();
  for (const sale of sales) {
    byId.set(sale.id, sale);
    if (sale.refundOfSaleId) {
      refundBySaleId.set(sale.refundOfSaleId, sale);
    }
  }
  return { byId, refundBySaleId };
}

export function hasRefundForSale(index: SaleIndex, saleId: string) {
  return index.refundBySaleId.has(saleId);
}

/** Newest first, each date parsed once rather than on every comparison. */
export function sortSalesNewestFirst<T extends { createdAt: string }>(
  sales: readonly T[]
): T[] {
  return sales
    .map((sale) => ({ sale, time: Date.parse(sale.createdAt) }))
    .sort((a, b) => b.time - a.time)
    .map(({ sale }) => sale);
}

export type SalesMetrics = {
  grossCents: number;
  discountCents: number;
  netRevenueCents: number;
  costCents: number;
  netEarningsCents: number;
  /** Sales recorded, refunded later or not; refund records are not sales. */
  transactionCount: number;
  refundCount: number;
  /** What the refunds gave back, as a positive amount. */
  refundedCents: number;
  averageTicketCents: number;
  hasUnknownCost: boolean;
};

export function computeMetrics(sales: Sale[]): SalesMetrics {
  const accountable = accountableSales(sales);
  const refundedSaleIds = new Set(
    accountable.flatMap((sale) =>
      sale.refundOfSaleId ? [sale.refundOfSaleId] : []
    )
  );
  const metrics: SalesMetrics = {
    grossCents: 0,
    discountCents: 0,
    netRevenueCents: 0,
    costCents: 0,
    netEarningsCents: 0,
    transactionCount: 0,
    refundCount: 0,
    refundedCents: 0,
    averageTicketCents: 0,
    hasUnknownCost: false,
  };
  // The average ticket (Reports' "Ticket prom.") is what a sale that stood
  // brought in: the net of the sales in the set that were not refunded
  // within it, over how many there are. A refund of a sale from before the
  // set takes nothing off it, and a sale refunded within the set counts
  // neither its amount nor itself.
  let ticketCents = 0;
  let ticketCount = 0;

  for (const sale of accountable) {
    metrics.grossCents += signed(sale, saleGrossCents(sale));
    metrics.discountCents += signed(sale, saleDiscountTotalCents(sale));
    metrics.netRevenueCents += saleNetCents(sale);
    metrics.costCents += signed(sale, saleCostCents(sale));
    metrics.netEarningsCents += saleProfitCents(sale);
    metrics.hasUnknownCost ||= saleHasUnknownCost(sale);

    if (sale.refundOfSaleId) {
      metrics.refundCount += 1;
      metrics.refundedCents += saleChargedCents(sale);
    } else {
      metrics.transactionCount += 1;
      if (!refundedSaleIds.has(sale.id)) {
        ticketCents += saleChargedCents(sale);
        ticketCount += 1;
      }
    }
  }

  metrics.averageTicketCents = ticketCount
    ? Math.round(ticketCents / ticketCount)
    : 0;
  return metrics;
}

// The category and product breakdowns use saleLineNetCents, so like the
// payment and seller breakdowns they add up to the net revenue: refunds count
// against their lines, and a row can be negative when a range holds the
// refund of a sale from before it.

export function computeCategoryTotals(sales: Sale[]) {
  const totals = new Map<string, number>();

  for (const sale of accountableSales(sales)) {
    const lineNets = saleLineNetCents(sale);
    sale.lines.forEach((line, index) => {
      totals.set(
        line.category,
        (totals.get(line.category) ?? 0) + lineNets[index]
      );
    });
  }

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .filter((item) => item.total !== 0)
    .sort((a, b) => b.total - a.total);
}

export function computePaymentTotals(sales: Sale[]) {
  const totals = new Map<PaymentMethod, number>();

  for (const sale of accountableSales(sales)) {
    totals.set(
      sale.paymentMethod,
      (totals.get(sale.paymentMethod) ?? 0) + saleNetCents(sale)
    );
  }

  return [...totals.entries()]
    .map(([paymentMethod, total]) => ({
      label: paymentLabels[paymentMethod],
      total,
    }))
    .filter((item) => item.total !== 0)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export function computeProductTotals(sales: Sale[]) {
  const totals = new Map<
    string,
    { productId: string; productName: string; quantity: number; total: number }
  >();

  for (const sale of accountableSales(sales)) {
    const lineNets = saleLineNetCents(sale);
    sale.lines.forEach((line, index) => {
      const current = totals.get(line.productId);
      totals.set(line.productId, {
        productId: line.productId,
        productName: line.productName,
        quantity: (current?.quantity ?? 0) + signed(sale, line.quantity),
        total: (current?.total ?? 0) + lineNets[index],
      });
    });
  }

  return [...totals.values()]
    .filter((item) => item.quantity !== 0 || item.total !== 0)
    .sort((a, b) => b.quantity - a.quantity || b.total - a.total);
}

export function computeUserTotals(sales: Sale[]) {
  const totals = new Map<
    string,
    {
      userId: string;
      userName: string;
      transactionCount: number;
      total: number;
    }
  >();

  for (const sale of accountableSales(sales)) {
    const current = totals.get(sale.userId) ?? {
      userId: sale.userId,
      userName: sale.userName,
      transactionCount: 0,
      total: 0,
    };

    totals.set(sale.userId, {
      userId: sale.userId,
      userName: current.userName,
      transactionCount:
        current.transactionCount + (sale.refundOfSaleId ? 0 : 1),
      total: current.total + saleNetCents(sale),
    });
  }

  return [...totals.values()]
    .filter((item) => item.transactionCount > 0 || item.total !== 0)
    .sort((a, b) => b.total - a.total);
}
