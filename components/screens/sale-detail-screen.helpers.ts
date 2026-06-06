import { minutesSince } from "@/lib/dates";
import { hasRefundForSale } from "@/lib/sales";
import type { Sale } from "@/lib/types";

export function canVoidSale(sale: Sale, sales: Sale[]) {
  return sale.status === "completed" && !hasRefundForSale(sales, sale.id) && minutesSince(sale.createdAt) <= 10;
}

export function canRefundSale(sale: Sale, sales: Sale[]) {
  return sale.status === "completed" && !hasRefundForSale(sales, sale.id);
}

export function saleStatusLabel(sale: Sale) {
  if (sale.status === "voided") return "Anulada";
  if (sale.refundOfSaleId) return "Reembolso";
  if (sale.status === "refunded") return "Reembolso";
  return "Completada";
}

export function saleReferenceLabel(sale: Sale) {
  return sale.refundOfSaleId ? `Reembolso de #${sale.refundOfSaleId.slice(-5)}` : `Venta #${sale.id.slice(-5)}`;
}
