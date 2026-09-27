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
 * Collapsed order for phones and tablets: item count + "Ver pedido" opens
 * the order sheet, and Cobrar goes straight to checkout.
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
        className="flex h-13 min-w-0 flex-1 items-center gap-3 rounded-full bg-muted pr-4 pl-1.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={`Ver pedido, ${count} ${count === 1 ? "producto" : "productos"}`}
      >
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-card text-primary">
          <ShoppingBag className="size-5" aria-hidden />
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground tabular-nums">
            {count}
          </span>
        </span>
        <strong className="min-w-0 flex-1 truncate text-sm">Ver pedido</strong>
        <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <Button
        type="button"
        size="lg"
        onClick={charge}
        className="shrink-0 gap-2.5 px-5 shadow-lg shadow-primary/25"
      >
        Cobrar
        <strong className="font-extrabold tabular-nums">
          {formatBs(subtotal, true)}
        </strong>
      </Button>
    </div>
  );
}
