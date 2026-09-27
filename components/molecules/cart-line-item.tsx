import { useEffect, useId, useState } from "react";
import { Edit3, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clampDiscount, formatBs, parseDiscountInput } from "@/lib/money";
import type { Product } from "@/lib/types";
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

  const lineSubtotal = product.priceCents * quantity;
  const discount = clampDiscount(lineDiscountCents, lineSubtotal);
  const lineTotal = Math.max(0, lineSubtotal - discount);

  function applyDiscount() {
    const value = parseDiscountInput(discountInput, lineSubtotal);
    if (value == null) {
      setDiscountError("Escribe un monto (5 o 5,50) o un porcentaje (10%).");
      return;
    }
    setDiscountError(null);
    setLineDiscount(productId, clampDiscount(value, lineSubtotal), reason);
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
          onClick={() => {
            setDiscountError(null);
            setDiscountOpen((open) => !open);
          }}
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
            onChange={(event) => {
              setDiscountInput(event.target.value);
              setDiscountError(null);
            }}
            inputMode="decimal"
            placeholder="Descuento"
            aria-label={`Descuento de ${product.name}`}
            aria-invalid={discountError ? true : undefined}
            aria-describedby={discountError ? discountErrorId : undefined}
            className="rounded-xl"
          />
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo opcional"
            aria-label={`Motivo opcional del descuento de ${product.name}`}
            maxLength={MAX_NOTE_LENGTH}
            className="rounded-xl"
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
              setDiscountError(null);
              setLineDiscount(productId, 0);
              setDiscountOpen(false);
            }}
          >
            Quitar
          </Button>
          {discountError ? (
            <p
              id={discountErrorId}
              className="col-span-full text-sm text-destructive"
            >
              {discountError}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
