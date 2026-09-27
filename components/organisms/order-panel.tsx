import { ShoppingBag, Trash2, X } from "lucide-react";
import { CartLineItem } from "@/components/molecules/cart-line-item";
import { Button } from "@/components/ui/button";
import { formatBs } from "@/lib/money";
import type { CartLine, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

export type CartDetail = CartLine & { product: Product };

export type OrderPanelProps = {
  lines: CartDetail[];
  subtotal: number;
  count: number;
  addToCart: (productId: string) => void;
  decrementCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  setLineDiscount: (
    productId: string,
    lineDiscountCents: number,
    lineDiscountReason?: string
  ) => void;
  clearCart: () => void;
  charge: () => void;
  /** Sheets get a close button; the desktop side panel doesn't. */
  onClose?: () => void;
  className?: string;
};

/**
 * The current order: line items, total, and the Cobrar action. Rendered as a
 * persistent side panel on desktop and inside a sheet on phones/tablets.
 */
export function OrderPanel({
  lines,
  subtotal,
  count,
  addToCart,
  decrementCart,
  removeFromCart,
  setLineDiscount,
  clearCart,
  charge,
  onClose,
  className,
}: OrderPanelProps) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 flex-1 truncate font-heading text-lg font-extrabold">
          Pedido
          {count ? (
            <span className="ml-2 align-middle text-sm font-semibold text-muted-foreground tabular-nums">
              {count} {count === 1 ? "producto" : "productos"}
            </span>
          ) : null}
        </h2>
        {count ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearCart}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
            Vaciar
          </Button>
        ) : null}
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Cerrar pedido"
            className="bg-muted hover:bg-muted/70"
          >
            <X className="size-5" />
          </Button>
        ) : null}
      </div>

      <div className="scroll-region min-h-0 flex-1 px-4">
        {lines.length ? (
          <div className="grid grid-cols-[minmax(0,1fr)]">
            {lines.map((line) => (
              <CartLineItem
                key={line.productId}
                productId={line.productId}
                quantity={line.quantity}
                product={line.product}
                decrementCart={decrementCart}
                addToCart={addToCart}
                removeFromCart={removeFromCart}
                lineDiscountCents={line.lineDiscountCents ?? 0}
                lineDiscountReason={line.lineDiscountReason}
                setLineDiscount={setLineDiscount}
              />
            ))}
          </div>
        ) : (
          <div className="grid h-full min-h-48 place-content-center justify-items-center gap-2 py-10 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
              <ShoppingBag className="size-6" aria-hidden />
            </span>
            <p className="font-semibold">Pedido vacío</p>
            <p className="max-w-56 text-sm text-muted-foreground">
              Tocá un producto para agregarlo al pedido.
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4 pt-3 pb-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <strong className="font-heading text-2xl font-extrabold tabular-nums">
            {formatBs(subtotal, true)}
          </strong>
        </div>
        <Button
          type="button"
          size="lg"
          disabled={!count}
          onClick={charge}
          className="w-full justify-between shadow-lg shadow-primary/20 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
        >
          <span>Cobrar</span>
          <strong className="font-extrabold tabular-nums">
            {formatBs(subtotal, true)}
          </strong>
        </Button>
      </div>
    </div>
  );
}
