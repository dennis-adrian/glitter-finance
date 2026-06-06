import { Minus, Plus, Trash2 } from "lucide-react";
import { formatBs } from "@/lib/money";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";

type CartLineItemProps = {
  productId: string;
  quantity: number;
  product: Product;
  decrementCart: (productId: string) => void;
  addToCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
};

export function CartLineItem({
  productId,
  quantity,
  product,
  decrementCart,
  addToCart,
  removeFromCart,
}: CartLineItemProps) {
  return (
    <article className="cart-line">
      <ProductArt product={product} compact />
      <div>
        <strong>{product.name}</strong>
        <span>{formatBs(product.priceCents, true)} c/u</span>
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
      <strong className="line-total">{formatBs(product.priceCents * quantity, true)}</strong>
      <button className="text-danger tiny-action" onClick={() => removeFromCart(productId)}>
        <Trash2 size={15} />
      </button>
    </article>
  );
}
