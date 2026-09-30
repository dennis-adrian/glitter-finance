import { Banknote, QrCode } from "lucide-react";
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
  statusLabel: string;
  openSale: (saleId: string) => void;
  requestVoid: (sale: Sale) => void;
  requestRefund: (sale: Sale) => void;
  /** Highlighted while its detail is open beside the list (desktop). */
  selected?: boolean;
};

export function SaleRow({
  sale,
  canVoid,
  canRefund,
  statusLabel,
  openSale,
  requestVoid,
  requestRefund,
  selected = false,
}: SaleRowProps) {
  const amount = saleNetCents(sale);
  const isRefundRecord = Boolean(sale.refundOfSaleId);

  return (
    <article
      className={cn(
        "border-b border-border py-2 last:border-b-0",
        sale.status === "voided" && "opacity-60"
      )}
    >
      <button
        type="button"
        className={cn(
          "-mx-2 grid w-[calc(100%+1rem)] grid-cols-[46px_minmax(0,1fr)_auto] gap-x-2.5 rounded-xl px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected && "bg-primary/10 hover:bg-primary/10"
        )}
        aria-current={selected ? "true" : undefined}
        onClick={() => openSale(sale.id)}
      >
        <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          {sale.paymentMethod === "cash" ? (
            <Banknote size={20} />
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
            {statusLabel !== "Completada" ? ` · ${statusLabel}` : ""}
          </span>
          <small className="block truncate text-sm text-muted-foreground">
            {sale.lines
              .map((line) => `${line.quantity}x ${line.productName}`)
              .join(", ")}
          </small>
          <small className="block text-xs text-muted-foreground">
            {sale.userName}
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
              onClick={() => requestVoid(sale)}
            >
              Anular
            </Button>
          ) : null}
          {canRefund ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => requestRefund(sale)}
            >
              Reembolso
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
