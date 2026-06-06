import { QrCode, ShoppingBag } from "lucide-react";
import clsx from "clsx";
import { relativeTime } from "@/lib/dates";
import { formatBs } from "@/lib/money";
import { paymentLabels, saleNetCents } from "@/lib/sales";
import type { Sale } from "@/lib/types";

type SaleRowProps = {
  sale: Sale;
  canVoid: boolean;
  canRefund: boolean;
  openSale: (saleId: string) => void;
  voidSale: (saleId: string) => void;
  refundSale: (saleId: string) => void;
};

export function SaleRow({ sale, canVoid, canRefund, openSale, voidSale, refundSale }: SaleRowProps) {
  const amount = saleNetCents(sale);
  const isRefundRecord = Boolean(sale.refundOfSaleId);

  return (
    <article className={clsx("sale-row", sale.status === "voided" && "muted-row")} onClick={() => openSale(sale.id)}>
      <span className="sale-icon">{sale.paymentMethod === "cash" ? <ShoppingBag size={20} /> : <QrCode size={20} />}</span>
      <div>
        <strong>{isRefundRecord ? "Reembolso" : `#${sale.id.slice(-5)}`}</strong>
        <span>
          {relativeTime(sale.createdAt)} · {paymentLabels[sale.paymentMethod]}
          {sale.status === "voided" ? " · Anulada" : ""}
        </span>
        <small>{sale.lines.map((line) => `${line.quantity}x ${line.productName}`).join(", ")}</small>
      </div>
      <b>{formatBs(amount, true)}</b>
      <div className="sale-actions">
        {canVoid ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              voidSale(sale.id);
            }}
          >
            Anular
          </button>
        ) : null}
        {canRefund ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              refundSale(sale.id);
            }}
          >
            Reembolso
          </button>
        ) : null}
      </div>
    </article>
  );
}
