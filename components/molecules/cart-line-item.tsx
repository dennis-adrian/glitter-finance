import { useEffect, useState } from "react";
import { Edit3, Minus, Plus, Trash2 } from "lucide-react";
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
    <article className="cart-line">
      <ProductArt product={product} compact />
      <div>
        <strong>{product.name}</strong>
        <span>{formatBs(product.priceCents, true)} c/u</span>
        {discount ? (
          <span>
            Desc. {formatBs(discount, true)}
            {lineDiscountReason ? ` · ${lineDiscountReason}` : ""}
          </span>
        ) : null}
      </div>
      <div className="stepper">
        <button onClick={() => decrementCart(productId)} aria-label="Restar">
          <Minus size={16} />
        </button>
        <b>{quantity}</b>
        <button onClick={() => addToCart(productId)} aria-label="Sumar">
          <Plus size={18} />
        </button>
      </div>
      <strong className="line-total">{formatBs(lineTotal, true)}</strong>
      <button
        className="tiny-action"
        onClick={() => setDiscountOpen((open) => !open)}
        aria-label={`Editar descuento de ${product.name}`}
      >
        <Edit3 size={15} />
      </button>
      <button
        className="text-danger tiny-action"
        onClick={() => removeFromCart(productId)}
        aria-label={`Quitar ${product.name} del carrito`}
      >
        <Trash2 size={15} />
      </button>
      {discountOpen ? (
        <div className="line-discount-editor">
          <input
            value={discountInput}
            onChange={(event) => setDiscountInput(event.target.value)}
            inputMode="decimal"
            placeholder="Descuento"
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo opcional"
          />
          <button onClick={applyDiscount}>Aplicar</button>
          <button
            onClick={() => {
              setDiscountInput("");
              setReason("");
              setLineDiscount(productId, 0);
              setDiscountOpen(false);
            }}
          >
            Quitar
          </button>
        </div>
      ) : null}
    </article>
  );
}
