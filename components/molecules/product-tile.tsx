"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getProductStock } from "@/lib/inventory";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";
import { ProductNamePrice } from "@/components/atoms/product-name-price";
import { StockBadge } from "@/components/atoms/stock-badge";

type ProductTileProps = {
  product: Product;
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  quantity: number;
  add: () => void;
  decrement: () => void;
};

function clearDomSelection() {
  const selection = window.getSelection?.();
  selection?.removeAllRanges();
}

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
  const activePointerId = useRef<number | null>(null);
  const stock = inventoryStockReady
    ? getProductStock(product, stockByProduct)
    : null;
  const stockAlert = stock?.state === "out" || stock?.state === "oversold";

  function clearTimer() {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => () => clearTimer(), []);

  function clearActivePointer(pointerId: number) {
    if (activePointerId.current !== pointerId) return;
    clearTimer();
    activePointerId.current = null;
  }

  return (
    <button
      type="button"
      className={cn(
        "gesture-surface group relative flex min-h-59 flex-col overflow-hidden rounded-2xl bg-card text-left ring-1 transition-transform active:scale-[0.985]",
        quantity
          ? "ring-2 ring-primary"
          : stockAlert
            ? "ring-destructive/40"
            : "ring-foreground/10"
      )}
      // Block OS/browser menus that compete with long-press (right-click,
      // Ctrl-click, Android long-press sheet, image save/share).
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        // Primary button / touch only — ignore secondary pointers,
        // right-click, and pen barrel.
        if (!event.isPrimary || event.button !== 0) return;
        clearTimer();
        activePointerId.current = event.pointerId;
        longPressed.current = false;
        clearDomSelection();
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          clearDomSelection();
          decrement();
        }, 520);
      }}
      onPointerUp={(event) => clearActivePointer(event.pointerId)}
      onPointerLeave={(event) => clearActivePointer(event.pointerId)}
      onPointerCancel={(event) => {
        if (activePointerId.current !== event.pointerId) return;
        clearTimer();
        activePointerId.current = null;
        // After a completed long-press, cancel can suppress click; reset
        // so the next keyboard activation still invokes add().
        longPressed.current = false;
      }}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        add();
      }}
    >
      <ProductArt product={product} />
      {quantity ? (
        <Badge className="absolute top-2 right-2 h-7 min-w-7 rounded-full px-2 text-sm font-bold tabular-nums">
          {quantity}×
        </Badge>
      ) : null}
      {stock ? <StockBadge stock={stock} /> : null}
      <ProductNamePrice product={product} />
    </button>
  );
}
