import clsx from "clsx";
import { formatBs } from "@/lib/money";
import type { Product } from "@/lib/types";
import { ProductArt } from "@/components/atoms/product-art";

type ProductCatalogCardProps = {
  product: Product;
  openEditor: (product: Product) => void;
  restoreProduct: (productId: string) => void;
};

export function ProductCatalogCard({
  product,
  openEditor,
  restoreProduct,
}: ProductCatalogCardProps) {
  return (
    <article className={clsx("catalog-card", product.archivedAt && "archived")}>
      <button className="catalog-card-main" onClick={() => openEditor(product)}>
        <ProductArt product={product} />
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
