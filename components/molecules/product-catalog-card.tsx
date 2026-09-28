import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductStock } from "@/lib/inventory";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";
import { ProductNamePrice } from "@/components/atoms/product-name-price";
import { StockBadge } from "@/components/atoms/stock-badge";

type ProductCatalogCardProps = {
  product: Product;
  stock: ProductStock | null;
  openEditor: (product: Product) => void;
  restoreProduct: (productId: string) => void;
  /** Another product save, archive or restore is still running. */
  restoreDisabled: boolean;
  restoring: boolean;
};

export function ProductCatalogCard({
  product,
  stock,
  openEditor,
  restoreProduct,
  restoreDisabled,
  restoring,
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
        {stock ? <StockBadge stock={stock} /> : null}
        <ProductNamePrice product={product} />
      </button>
      {product.archivedAt ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mx-1 mb-2 justify-start"
          disabled={restoreDisabled}
          onClick={() => restoreProduct(product.id)}
        >
          {restoring ? "Restaurando…" : "Restaurar"}
        </Button>
      ) : null}
    </article>
  );
}
