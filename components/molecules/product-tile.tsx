"use client";

import { useRef } from "react";
import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
import { formatBs } from "@/lib/money";
import {
  getProductStock,
  stockAriaLabel,
  stockBadgeLabel,
  stockNeedsGlyph,
} from "@/lib/inventory";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";

type ProductTileProps = {
  product: Product;
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  quantity: number;
  add: () => void;
  decrement: () => void;
};

export function ProductTile({
  product,
  stockByProduct,
  inventoryStockReady,
  quantity,
  add,
  decrement,
}: ProductTileProps) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const stock = inventoryStockReady
    ? getProductStock(product, stockByProduct)
    : null;

  function clearTimer() {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  return (
    <button
      className={clsx(
        "product-tile",
        stock && `stock-${stock.state}`
      )}
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
      {stock ? (
        <span
          className={clsx("stock-badge", stock.state)}
          aria-label={stockAriaLabel(stock)}
        >
          {stockNeedsGlyph(stock.state) ? (
            <TriangleAlert size={11} aria-hidden="true" />
          ) : null}
          {stockBadgeLabel(stock)}
        </span>
      ) : null}
      <span className="product-copy">
        <span>{product.name}</span>
        <strong>{formatBs(product.priceCents, true)}</strong>
      </span>
    </button>
  );
}
