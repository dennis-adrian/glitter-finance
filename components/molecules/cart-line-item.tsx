import { useEffect, useState } from "react";
import { Edit3, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clampDiscount, formatBs } from "@/lib/money";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";
import { parseCustomDiscount } from "@/components/screens/payment-screen.helpers";

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

  useEffect(() => {
    if (discountOpen) {
      setDiscountInput(
        lineDiscountCents ? String(lineDiscountCents / 100) : ""
      );
      setReason(lineDiscountReason ?? "");
    }
  }, [lineDiscountCents, lineDiscountReason, discountOpen]);

  const lineSubtotal = product.priceCents * quantity;
  const discount = clampDiscount(lineDiscountCents, lineSubtotal);
  const lineTotal = Math.max(0, lineSubtotal - discount);

  function applyDiscount() {
    setLineDiscount(
      productId,
      clampDiscount(
        parseCustomDiscount(discountInput, lineSubtotal),
        lineSubtotal
      ),
      reason
    );
    setDiscountOpen(false);
  }

  return (
    <article className="rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex items-center gap-3">
        <ProductArt product={product} compact />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-base leading-tight font-semibold">
            {product.name}
          </strong>
          <span className="block text-sm text-muted-foreground">
            {formatBs(product.priceCents, true)} c/u
          </span>
          {discount ? (
            <span className="block text-sm text-muted-foreground">
              Desc. {formatBs(discount, true)}
              {lineDiscountReason ? ` · ${lineDiscountReason}` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <strong className="text-base font-bold tabular-nums text-primary">
            {formatBs(lineTotal, true)}
          </strong>
          <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={() => decrementCart(productId)}
              aria-label="Restar"
            >
              <Minus />
            </Button>
            <b className="w-6 text-center text-sm font-semibold tabular-nums">
              {quantity}
            </b>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={() => addToCart(productId)}
              aria-label="Sumar"
            >
              <Plus />
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setDiscountOpen((open) => !open)}
          aria-label={`Editar descuento de ${product.name}`}
        >
          <Edit3 />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          onClick={() => removeFromCart(productId)}
          aria-label={`Quitar ${product.name} del carrito`}
        >
          <Trash2 />
        </Button>
      </div>
      {discountOpen ? (
        <div className="mt-1 grid grid-cols-[1fr_1fr_auto_auto] gap-2">
          <Input
            value={discountInput}
            onChange={(event) => setDiscountInput(event.target.value)}
            inputMode="decimal"
            placeholder="Descuento"
            className="h-9 rounded-xl"
          />
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo opcional"
            className="h-9 rounded-xl"
          />
          <Button type="button" size="sm" onClick={applyDiscount}>
            Aplicar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDiscountInput("");
              setReason("");
              setLineDiscount(productId, 0);
              setDiscountOpen(false);
            }}
          >
            Quitar
          </Button>
        </div>
      ) : null}
    </article>
  );
}
