import { ChevronUp, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBs } from "@/lib/money";

type CheckoutBarProps = {
  count: number;
  subtotal: number;
  openOrder: () => void;
  charge: () => void;
};

/**
 * Collapsed order for phones and tablets: the bag (with item count) opens
 * the order sheet, and Cobrar goes straight to checkout. Phones show only
 * the bag icon so Cobrar gets the width; tablets add the "Ver pedido" label.
 */
export function CheckoutBar({
  count,
  subtotal,
  openOrder,
  charge,
}: CheckoutBarProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={openOrder}
        className="flex size-13 shrink-0 items-center justify-center gap-3 rounded-full bg-muted text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 md:w-auto md:min-w-0 md:flex-1 md:justify-start md:pr-4 md:pl-1.5"
        aria-label={`Ver pedido, ${count} ${count === 1 ? "producto" : "productos"}`}
      >
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-card text-primary">
          <ShoppingBag className="size-5" aria-hidden />
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground tabular-nums">
            {count}
          </span>
        </span>
        <strong className="hidden min-w-0 flex-1 truncate text-sm md:block">
          Ver pedido
        </strong>
        <ChevronUp className="hidden size-4 shrink-0 text-muted-foreground md:block" />
      </button>
      <Button
        type="button"
        size="lg"
        onClick={charge}
        className="min-w-0 flex-1 justify-between gap-2.5 px-5 shadow-lg shadow-primary/25 md:flex-none md:justify-center"
      >
        Cobrar
        <strong className="font-extrabold tabular-nums">
          {formatBs(subtotal, true)}
        </strong>
      </Button>
    </div>
  );
}
