import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBs } from "@/lib/money";

type CheckoutDockProps = {
  cartCount: number;
  cartSubtotal: number;
  openCart: () => void;
  openPayment: () => void;
};

export function CheckoutDock({
  cartCount,
  cartSubtotal,
  openCart,
  openPayment,
}: CheckoutDockProps) {
  return (
    <div className="absolute right-4 bottom-[76px] left-4 grid grid-cols-[58px_1fr] gap-3">
      <Button
        type="button"
        variant="secondary"
        onClick={openCart}
        aria-label="Ver carrito"
        className="relative h-14 rounded-2xl"
      >
        <ReceiptText className="size-[22px]" />
        {cartCount ? (
          <span className="absolute -top-2 -right-1.5 grid h-[22px] min-w-[22px] place-items-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground tabular-nums">
            {cartCount}
          </span>
        ) : null}
      </Button>
      <Button
        type="button"
        disabled={!cartCount}
        onClick={openPayment}
        className="h-14 justify-between rounded-2xl px-6 text-base shadow-lg shadow-primary/25 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
      >
        <span className="font-extrabold tracking-wide">COBRAR</span>
        <strong className="text-lg font-extrabold tabular-nums">
          {formatBs(cartSubtotal, true)}
        </strong>
      </Button>
    </div>
  );
}
