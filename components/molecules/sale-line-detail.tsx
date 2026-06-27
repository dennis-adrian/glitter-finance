import { formatBs } from "@/lib/money";
import type { SaleLine } from "@/lib/types";

type SaleLineDetailProps = {
  line: SaleLine;
};

export function SaleLineDetail({ line }: SaleLineDetailProps) {
  const lineTotal =
    line.unitPriceCents * line.quantity - line.lineDiscountCents;

  return (
    <article className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/5">
      <div>
        <strong className="block text-sm font-semibold">
          {line.productName}
        </strong>
        <span className="block text-xs text-muted-foreground">
          {line.category}
        </span>
      </div>
      <div className="text-right">
        <strong className="block text-sm font-semibold text-primary tabular-nums">
          {formatBs(lineTotal, true)}
        </strong>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {line.quantity} x {formatBs(line.unitPriceCents, true)}
        </span>
      </div>
      <small className="col-span-2 text-xs text-muted-foreground">
        Costo snapshoteado:{" "}
        {line.unitCostCents == null
          ? "Desconocido"
          : formatBs(line.unitCostCents, true)}
      </small>
    </article>
  );
}
