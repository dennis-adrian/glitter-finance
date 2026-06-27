import { QrCode, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

export function SaleRow({
  sale,
  canVoid,
  canRefund,
  openSale,
  voidSale,
  refundSale,
}: SaleRowProps) {
  const amount = saleNetCents(sale);
  const isRefundRecord = Boolean(sale.refundOfSaleId);

  return (
    <article
      className={cn(
        "border-b border-border py-3.5 last:border-b-0",
        sale.status === "voided" && "opacity-60"
      )}
    >
      <button
        type="button"
        className="grid w-full grid-cols-[46px_1fr_auto] gap-x-2.5 text-left"
        onClick={() => openSale(sale.id)}
      >
        <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          {sale.paymentMethod === "cash" ? (
            <ShoppingBag size={20} />
          ) : (
            <QrCode size={20} />
          )}
        </span>
        <div className="min-w-0">
          <strong className="block text-base">
            {isRefundRecord ? "Reembolso" : `#${sale.id.slice(-5)}`}
          </strong>
          <span className="block text-sm text-muted-foreground">
            {relativeTime(sale.createdAt)} · {paymentLabels[sale.paymentMethod]}
            {sale.status === "voided" ? " · Anulada" : ""}
          </span>
          <small className="block max-w-[190px] truncate text-sm text-muted-foreground">
            {sale.lines
              .map((line) => `${line.quantity}x ${line.productName}`)
              .join(", ")}
          </small>
        </div>
        <b className="text-base whitespace-nowrap tabular-nums">
          {formatBs(amount, true)}
        </b>
      </button>
      {canVoid || canRefund ? (
        <div className="mt-2 flex gap-2 pl-[54px]">
          {canVoid ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => voidSale(sale.id)}
            >
              Anular
            </Button>
          ) : null}
          {canRefund ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refundSale(sale.id)}
            >
              Reembolso
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
