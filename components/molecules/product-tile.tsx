"use client";

import { useRef } from "react";
import { formatBs } from "@/lib/money";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";

type ProductTileProps = {
  product: Product;
  quantity: number;
  add: () => void;
  decrement: () => void;
};

export function ProductTile({ product, quantity, add, decrement }: ProductTileProps) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  function clearTimer() {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  return (
    <button
      className="product-tile"
      onPointerDown={() => {
        longPressed.current = false;
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          decrement();
        }, 520);
      }}
      onPointerUp={() => clearTimer()}
      onPointerLeave={() => clearTimer()}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        add();
      }}
    >
      <ProductArt product={product} />
      {quantity ? <span className="quantity-pill">{quantity}x</span> : null}
      <span className="product-copy">
        <span>{product.name}</span>
        <strong>{formatBs(product.priceCents, true)}</strong>
      </span>
    </button>
  );
}
