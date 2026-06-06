import { formatBs } from "@/lib/money";
import type { PaymentMethod, Sale } from "@/lib/types";

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  qr_transfer: "QR",
};

export function saleGrossCents(sale: Sale) {
  return sale.lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
}

export function saleNetCents(sale: Sale) {
  const value = Math.max(0, saleGrossCents(sale) - sale.saleDiscountCents);
  return sale.refundOfSaleId ? -value : value;
}

export function saleTotal(sale: Sale) {
  return formatBs(saleNetCents(sale), true);
}

export function computeMetrics(sales: Sale[]) {
  const accountable = sales.filter((sale) => sale.status !== "voided");

  return accountable.reduce(
    (metrics, sale) => {
      const sign = sale.refundOfSaleId ? -1 : 1;
      const gross = saleGrossCents(sale);
      const discount = sale.saleDiscountCents;
      const cost = sale.lines.reduce((total, line) => total + (line.unitCostCents ?? 0) * line.quantity, 0);
      const hasUnknown = sale.lines.some((line) => line.unitCostCents == null);

      return {
        grossCents: metrics.grossCents + gross * sign,
        discountCents: metrics.discountCents + discount * sign,
        netRevenueCents: metrics.netRevenueCents + Math.max(0, gross - discount) * sign,
        costCents: metrics.costCents + cost * sign,
        netEarningsCents: metrics.netEarningsCents + (Math.max(0, gross - discount) - cost) * sign,
        transactionCount: metrics.transactionCount + (sale.refundOfSaleId ? 0 : 1),
        hasUnknownCost: metrics.hasUnknownCost || hasUnknown,
      };
    },
    {
      grossCents: 0,
      discountCents: 0,
      netRevenueCents: 0,
      costCents: 0,
      netEarningsCents: 0,
      transactionCount: 0,
      hasUnknownCost: false,
    },
  );
}

export function computeCategoryTotals(sales: Sale[]) {
  const totals = new Map<string, number>();

  sales
    .filter((sale) => sale.status !== "voided")
    .forEach((sale) => {
      const sign = sale.refundOfSaleId ? -1 : 1;
      sale.lines.forEach((line) => {
        totals.set(line.category, (totals.get(line.category) ?? 0) + line.unitPriceCents * line.quantity * sign);
      });
    });

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}
