import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
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
    <article className={clsx("catalog-card", product.archivedAt && "archived")}>
      <button className="catalog-card-main" onClick={() => openEditor(product)}>
        <ProductArt product={product} />
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
        <span>{product.name}</span>
        <strong>{formatBs(product.priceCents, true)}</strong>
      </button>
      {product.archivedAt ? (
        <button
          className="restore-chip"
          onClick={() => restoreProduct(product.id)}
        >
          Restaurar
        </button>
      ) : null}
    </article>
  );
}
