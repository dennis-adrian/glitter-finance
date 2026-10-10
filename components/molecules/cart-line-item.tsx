import { useEffect, useId, useState } from "react";
import { Minus, Percent, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clampDiscount, formatBs, parseDiscountInput } from "@/lib/money";
import { priceLine } from "@/lib/sales/pricing";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MAX_NOTE_LENGTH } from "@/lib/validation";
import { ProductArt } from "@/components/atoms/product-art";

type CartLineItemProps = {
  productId: string;
  quantity: number;
  product: Product;
  decrementCart: (productId: string) => void;
  addToCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  lineDiscountCents: number;
  lineDiscountReason?: string;
  setLineDiscount: (
    productId: string,
    lineDiscountCents: number,
    lineDiscountReason?: string
  ) => void;
};

/**
 * One order line: art, name, and total on the first row; quantity stepper
 * and line actions on the second, so it fits a 320px sheet or side panel.
 */
export function CartLineItem({
  productId,
  quantity,
  product,
  decrementCart,
  addToCart,
  removeFromCart,
  lineDiscountCents,
  lineDiscountReason,
  setLineDiscount,
}: CartLineItemProps) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState(
    lineDiscountCents ? String(lineDiscountCents / 100) : ""
  );
  const [reason, setReason] = useState(lineDiscountReason ?? "");
  const [discountError, setDiscountError] = useState<string | null>(null);
  const discountErrorId = useId();

  useEffect(() => {
    if (discountOpen) {
      setDiscountInput(
        lineDiscountCents ? String(lineDiscountCents / 100) : ""
      );
      setReason(lineDiscountReason ?? "");
    }
  }, [lineDiscountCents, lineDiscountReason, discountOpen]);

  const {
    grossCents: lineSubtotal,
    discountCents: discount,
    totalCents: lineTotal,
  } = priceLine({
    priceCents: product.priceCents,
    quantity,
    lineDiscountCents,
  });

  function applyDiscount() {
    const value = parseDiscountInput(discountInput, lineSubtotal);
    if (value == null) {
      setDiscountError("Escribí un monto (5 o 5,50) o un porcentaje (10%).");
      return;
    }
    setDiscountError(null);
    setLineDiscount(productId, clampDiscount(value, lineSubtotal), reason);
    setDiscountOpen(false);
  }

  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-border py-3 last:border-b-0">
      <span className="row-span-2">
        <ProductArt product={product} compact />
      </span>
      <div className="min-w-0">
        <strong className="line-clamp-2 text-sm leading-snug font-semibold">
          {product.name}
        </strong>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatBs(product.priceCents, true)} c/u
          {discount ? (
            <>
              {" · "}
              <span className="text-primary">
                −{formatBs(discount, true)}
                {lineDiscountReason ? ` (${lineDiscountReason})` : ""}
              </span>
            </>
          ) : null}
        </span>
      </div>
      <strong className="text-right text-sm font-bold text-primary tabular-nums">
        {formatBs(lineTotal, true)}
      </strong>

      <div className="col-span-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full hover:bg-card"
            onClick={() => decrementCart(productId)}
            aria-label={`Restar uno de ${product.name}`}
          >
            <Minus />
          </Button>
          <b
            className="w-7 text-center text-sm font-semibold tabular-nums"
            aria-label={`Cantidad: ${quantity}`}
          >
            {quantity}
          </b>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full hover:bg-card"
            onClick={() => addToCart(productId)}
            aria-label={`Sumar uno de ${product.name}`}
          >
            <Plus />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(discount && "text-primary")}
            onClick={() => {
              setDiscountError(null);
              setDiscountOpen((open) => !open);
            }}
            aria-expanded={discountOpen}
            aria-label={`Descuento de ${product.name}`}
          >
            <Percent />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            onClick={() => removeFromCart(productId)}
            aria-label={`Quitar ${product.name} del pedido`}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {discountOpen ? (
        <div className="col-span-3 grid gap-2 rounded-2xl bg-muted/60 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={discountInput}
              onChange={(event) => {
                setDiscountInput(event.target.value);
                setDiscountError(null);
              }}
              inputMode="decimal"
              placeholder="Ej. 5 o 10%"
              aria-label={`Descuento de ${product.name}`}
              aria-invalid={discountError ? true : undefined}
              aria-describedby={discountError ? discountErrorId : undefined}
              autoFocus
            />
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Motivo (opcional)"
              aria-label={`Motivo del descuento de ${product.name}`}
              maxLength={MAX_NOTE_LENGTH}
            />
          </div>
          {discountError ? (
            <p id={discountErrorId} className="text-sm text-destructive">
              {discountError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {discount ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDiscountInput("");
                  setReason("");
                  setDiscountError(null);
                  setLineDiscount(productId, 0);
                  setDiscountOpen(false);
                }}
              >
                Quitar descuento
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={applyDiscount}>
              Aplicar
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
