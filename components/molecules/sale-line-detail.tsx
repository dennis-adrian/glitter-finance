import { formatBs } from "@/lib/money";
import type { SaleLine } from "@/lib/types";

type SaleLineDetailProps = {
  line: SaleLine;
};

export function SaleLineDetail({ line }: SaleLineDetailProps) {
  const lineTotal = line.unitPriceCents * line.quantity - line.lineDiscountCents;

  return (
    <article className="sale-line-detail">
      <div>
        <strong>{line.productName}</strong>
        <span>{line.category}</span>
      </div>
      <div className="sale-line-money">
        <strong>{formatBs(lineTotal, true)}</strong>
        <span>
          {line.quantity} x {formatBs(line.unitPriceCents, true)}
        </span>
      </div>
      <small>
        Costo snapshoteado: {line.unitCostCents == null ? "Desconocido" : formatBs(line.unitCostCents, true)}
      </small>
    </article>
  );
}
