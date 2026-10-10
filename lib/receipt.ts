import { BOLIVIA_TIME_ZONE } from "@/lib/dates";
import { formatBs } from "@/lib/money";
import { paymentLabels } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/types";

/** Snapshot of a just-recorded sale, kept for the confirmation screen. */
export type CompletedSaleSummary = {
  saleId: string | null;
  createdAt: string;
  paymentMethod: PaymentMethod;
  lines: { name: string; quantity: number; totalCents: number }[];
  itemCount: number;
  /** Sum of lines after line discounts. */
  subtotalCents: number;
  /** Sale-level discount applied at checkout. */
  discountCents: number;
  totalCents: number;
  receivedCents: number | null;
  changeCents: number | null;
};

const receiptDateFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: BOLIVIA_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Plain-text receipt for WhatsApp/SMS sharing or the clipboard. */
export function buildReceiptText(
  sale: CompletedSaleSummary,
  storeName?: string | null
) {
  const lines = [
    storeName ? `${storeName} · Billetera Ferial` : "Billetera Ferial",
    receiptDateFormatter.format(new Date(sale.createdAt)),
    "",
    ...sale.lines.map(
      (line) =>
        `${line.quantity}× ${line.name} — ${formatBs(line.totalCents, true)}`
    ),
    "",
  ];

  if (sale.discountCents > 0) {
    lines.push(`Subtotal: ${formatBs(sale.subtotalCents, true)}`);
    lines.push(`Descuento: −${formatBs(sale.discountCents, true)}`);
  }
  lines.push(`Total: ${formatBs(sale.totalCents, true)}`);
  lines.push(`Pago: ${paymentLabels[sale.paymentMethod]}`);
  if (sale.receivedCents != null && sale.changeCents) {
    lines.push(`Recibido: ${formatBs(sale.receivedCents, true)}`);
    lines.push(`Cambio: ${formatBs(sale.changeCents, true)}`);
  }
  lines.push("", "¡Gracias por tu compra!");

  return lines.join("\n");
}
