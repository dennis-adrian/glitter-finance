import { hasRefundForSale } from "@/lib/sales";
import type { Sale } from "@/lib/types";

const VOID_WINDOW_MS = 10 * 60 * 1000;
/** Allow small device/server clock skew; reject only clearly future createdAt. */
const CLOCK_SKEW_TOLERANCE_MS = 5_000;

export function canVoidSale(sale: Sale, sales: Sale[], now = Date.now()) {
  const createdAt = new Date(sale.createdAt).getTime();

  return (
    sale.status === "completed" &&
    !hasRefundForSale(sales, sale.id) &&
    !Number.isNaN(createdAt) &&
    createdAt - now <= CLOCK_SKEW_TOLERANCE_MS &&
    now - createdAt <= VOID_WINDOW_MS
  );
}

export function canRefundSale(sale: Sale, sales: Sale[]) {
  return sale.status === "completed" && !hasRefundForSale(sales, sale.id);
}

export function saleStatusLabel(sale: Sale, sales: Sale[] = []) {
  if (sale.status === "voided") return "Anulada";
  if (sale.refundOfSaleId) return "Reembolso";
  if (sale.status === "refunded") return "Reembolso";
  if (hasRefundForSale(sales, sale.id)) return "Reembolsada";
  return "Completada";
}

export function saleReferenceLabel(sale: Sale) {
  return sale.refundOfSaleId
    ? `Reembolso de #${sale.refundOfSaleId.slice(-5)}`
    : `Venta #${sale.id.slice(-5)}`;
}
