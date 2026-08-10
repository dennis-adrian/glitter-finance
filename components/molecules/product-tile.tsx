"use client";

import { useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
        // Primary button / touch only — ignore right-click and pen barrel.
        if (event.button !== 0) return;
        longPressed.current = false;
        clearDomSelection();
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          clearDomSelection();
          decrement();
        }, 520);
      }}
      onPointerUp={() => clearTimer()}
      onPointerLeave={() => clearTimer()}
      onPointerCancel={() => clearTimer()}
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
      {stock ? (
        <Badge
          variant={stock.state === "oversold" ? "destructive" : "secondary"}
          className="absolute top-2 left-2 h-6 gap-1 rounded-full font-semibold"
          aria-label={stockAriaLabel(stock)}
        >
          {stockNeedsGlyph(stock.state) ? (
            <TriangleAlert aria-hidden="true" />
          ) : null}
          {stockBadgeLabel(stock)}
        </Badge>
      ) : null}
      <div className="px-3 pt-2.5 pb-3.5">
        <span className="block text-[15px] leading-tight text-foreground">
          {product.name}
        </span>
        <strong className="mt-1 block text-xl leading-none font-bold text-primary">
          {formatBs(product.priceCents, true)}
        </strong>
      </div>
    </button>
  );
}
