import { formatBs } from "@/lib/money";
import type { PaymentMethod, Sale } from "@/lib/types";

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  qr_transfer: "QR",
};

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

export function saleNetCents(sale: Sale) {
  const value = Math.max(0, saleLineTotalCents(sale) - sale.saleDiscountCents);
  return sale.refundOfSaleId ? -value : value;
}

export function saleProfitCents(sale: Sale) {
  const value = Math.max(0, saleLineTotalCents(sale) - sale.saleDiscountCents);
  const profit = value - saleCostCents(sale);
  return sale.refundOfSaleId ? -profit : profit;
}

export function saleTotal(sale: Sale) {
  return formatBs(saleNetCents(sale), true);
}

export function hasRefundForSale(sales: Sale[], saleId: string) {
  return sales.some((sale) => sale.refundOfSaleId === saleId);
}

export function computeMetrics(sales: Sale[]) {
  const accountable = sales.filter((sale) => sale.status !== "voided");

  return accountable.reduce(
    (metrics, sale) => {
      const sign = sale.refundOfSaleId ? -1 : 1;
      const gross = saleGrossCents(sale);
      const discount = saleDiscountTotalCents(sale);
      const lineTotal = saleLineTotalCents(sale);
      const cost = sale.lines.reduce(
        (total, line) => total + (line.unitCostCents ?? 0) * line.quantity,
        0
      );
      const hasUnknown = sale.lines.some((line) => line.unitCostCents == null);

      return {
        grossCents: metrics.grossCents + gross * sign,
        discountCents: metrics.discountCents + discount * sign,
        netRevenueCents:
          metrics.netRevenueCents +
          Math.max(0, lineTotal - sale.saleDiscountCents) * sign,
        costCents: metrics.costCents + cost * sign,
        netEarningsCents:
          metrics.netEarningsCents +
          (Math.max(0, lineTotal - sale.saleDiscountCents) - cost) * sign,
        transactionCount:
          metrics.transactionCount + (sale.refundOfSaleId ? 0 : 1),
        refundCount: metrics.refundCount + (sale.refundOfSaleId ? 1 : 0),
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
      refundCount: 0,
      hasUnknownCost: false,
    }
  );
}

export function computeCategoryTotals(sales: Sale[]) {
  const totals = new Map<string, number>();

  sales
    .filter((sale) => sale.status !== "voided")
    .forEach((sale) => {
      const sign = sale.refundOfSaleId ? -1 : 1;
      sale.lines.forEach((line) => {
        totals.set(
          line.category,
          (totals.get(line.category) ?? 0) + line.lineTotalCents * sign
        );
      });
    });

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function computePaymentTotals(sales: Sale[]) {
  const totals = new Map<PaymentMethod, number>();

  sales
    .filter((sale) => sale.status !== "voided")
    .forEach((sale) => {
      totals.set(
        sale.paymentMethod,
        (totals.get(sale.paymentMethod) ?? 0) + saleNetCents(sale)
      );
    });

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

  sales
    .filter((sale) => sale.status !== "voided")
    .forEach((sale) => {
      const sign = sale.refundOfSaleId ? -1 : 1;
      sale.lines.forEach((line) => {
        const productId = line.productId || line.productName;
        const current = totals.get(productId) ?? {
          productId,
          productName: line.productName,
          quantity: 0,
          total: 0,
        };

        totals.set(productId, {
          productId,
          productName: line.productName,
          quantity: current.quantity + line.quantity * sign,
          total: current.total + line.lineTotalCents * sign,
        });
      });
    });

  return [...totals.values()]
    .filter((item) => item.quantity > 0 || item.total > 0)
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

  sales
    .filter((sale) => sale.status !== "voided")
    .forEach((sale) => {
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
    });

  return [...totals.values()]
    .filter((item) => item.transactionCount > 0 || item.total !== 0)
    .sort((a, b) => b.total - a.total);
}
