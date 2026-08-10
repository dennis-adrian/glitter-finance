import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBs } from "@/lib/money";
import {
  type ProductStock,
  stockAriaLabel,
  stockBadgeLabel,
  stockNeedsGlyph,
} from "@/lib/inventory";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";

type ProductCatalogCardProps = {
  product: Product;
  stock: ProductStock | null;
  openEditor: (product: Product) => void;
  restoreProduct: (productId: string) => void;
};

export function ProductCatalogCard({
  product,
  stock,
  openEditor,
  restoreProduct,
}: ProductCatalogCardProps) {
  return (
    <article
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10",
        product.archivedAt && "opacity-55"
      )}
    >
      <button
        type="button"
        className="gesture-surface block flex-1 text-left transition-transform active:scale-[0.985]"
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onClick={() => openEditor(product)}
      >
        <ProductArt product={product} />
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
      {product.archivedAt ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mx-1 mb-2 justify-start"
          onClick={() => restoreProduct(product.id)}
        >
          Restaurar
        </Button>
      ) : null}
    </article>
  );
}
