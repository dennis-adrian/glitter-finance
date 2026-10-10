import { ChevronUp, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBs } from "@/lib/money";
import { countLabel } from "@/lib/plural";

type CheckoutBarProps = {
  count: number;
  subtotal: number;
  openOrder: () => void;
  charge: () => void;
};

/**
 * Collapsed order for phones and tablets: the bag (with item count) opens
 * the order sheet, and Cobrar goes straight to checkout. Phones show the
 * bag and the expand caret so Cobrar gets the width; tablets add the
 * "Ver pedido" label between them. Always visible on Vender (disabled while
 * the order is empty) so the selling screen never looks like the catalog.
 */
export function CheckoutBar({
  count,
  subtotal,
  openOrder,
  charge,
}: CheckoutBarProps) {
  const isEmpty = count === 0;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={openOrder}
        disabled={isEmpty}
        className="flex h-13 shrink-0 items-center gap-2 rounded-full bg-muted pr-3.5 pl-1.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:min-w-0 md:flex-1 md:gap-3 md:pr-4"
        aria-label={
          isEmpty
            ? "Pedido vacío"
            : `Ver pedido, ${countLabel(count, "producto", "productos")}`
        }
      >
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-card text-primary">
          <ShoppingBag className="size-5" aria-hidden />
          {isEmpty ? null : (
            <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </span>
        <strong className="hidden min-w-0 flex-1 truncate text-sm md:block">
          Ver pedido
        </strong>
        <ChevronUp
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </button>
      <Button
        type="button"
        size="lg"
        onClick={charge}
        disabled={isEmpty}
        className="min-w-0 flex-1 justify-between gap-2.5 px-5 shadow-lg shadow-primary/25 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none md:flex-none md:justify-center"
      >
        Cobrar
        <strong className="font-extrabold tabular-nums">
          {formatBs(subtotal, true)}
        </strong>
      </Button>
    </div>
  );
}
