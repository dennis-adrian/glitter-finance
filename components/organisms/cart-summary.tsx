import { BadgeDollarSign, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBs } from "@/lib/money";

type CartSummaryProps = {
  itemCount: number;
  subtotal: number;
  clearCart: () => void;
  back: () => void;
  charge: () => void;
};

export function CartSummary({
  itemCount,
  subtotal,
  clearCart,
  back,
  charge,
}: CartSummaryProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 bg-card px-4 pt-7 pb-5 shadow-[0_-14px_38px_rgba(32,24,48,0.13)]">
      <span className="text-sm text-muted-foreground">
        Subtotal ({itemCount} productos)
      </span>
      <div className="mt-0.5 mb-4 flex items-center justify-between">
        <strong className="text-2xl font-bold tabular-nums">
          Total: {formatBs(subtotal, true)}
        </strong>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearCart}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
          Vaciar
        </Button>
      </div>
      <Button
        size="lg"
        disabled={!itemCount}
        onClick={charge}
        className="w-full rounded-2xl font-extrabold tracking-wide shadow-lg shadow-primary/25 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
      >
        <BadgeDollarSign className="size-5" />
        COBRAR
      </Button>
      <Button
        variant="outline"
        onClick={back}
        className="mt-3 w-full rounded-2xl"
      >
        Agregar más productos
      </Button>
    </div>
  );
}
