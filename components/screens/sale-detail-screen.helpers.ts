import {
  hasRefundForSale,
  isWithinVoidWindow,
  REFUNDED_SALE_VOID_MESSAGE,
  SALE_ALREADY_REFUNDED_MESSAGE,
  SALE_ALREADY_VOIDED_MESSAGE,
  VOID_WINDOW_EXPIRED_MESSAGE,
  VOIDED_SALE_REFUND_MESSAGE,
  type SaleIndex,
} from "@/lib/sales";
import type { Sale } from "@/lib/types";

export type SaleAction = "void" | "refund";

/**
 * Why `action` cannot be applied to the sale now, or null when it can. The
 * sale is looked up in `sales`, the index of the current list, so a void or
 * refund that arrived while a dialog was open (from this device or, synced,
 * from another) counts, and a void is refused once its window has passed.
 */
export function saleActionBlockedMessage(
  action: SaleAction,
  sale: Sale,
  sales: SaleIndex,
  now = Date.now()
): string | null {
  const current = sales.byId.get(sale.id) ?? sale;
  if (current.status === "voided") {
    return action === "void"
      ? SALE_ALREADY_VOIDED_MESSAGE
      : VOIDED_SALE_REFUND_MESSAGE;
  }
  if (hasRefundForSale(sales, current.id)) {
    return action === "void"
      ? REFUNDED_SALE_VOID_MESSAGE
      : SALE_ALREADY_REFUNDED_MESSAGE;
  }
  if (current.status !== "completed") {
    return "Un reembolso no se puede anular ni reembolsar.";
  }
  if (action === "void" && !isWithinVoidWindow(current.createdAt, now)) {
    return VOID_WINDOW_EXPIRED_MESSAGE;
  }
  return null;
}

export function canVoidSale(sale: Sale, sales: SaleIndex, now = Date.now()) {
  return saleActionBlockedMessage("void", sale, sales, now) == null;
}

export function canRefundSale(sale: Sale, sales: SaleIndex) {
  return saleActionBlockedMessage("refund", sale, sales) == null;
}

export function saleStatusLabel(sale: Sale, sales: SaleIndex) {
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
