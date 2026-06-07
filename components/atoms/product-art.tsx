import clsx from "clsx";
import { getProductInitial } from "@/lib/products";
import type { Product } from "@/lib/types";

type ProductArtProps = {
  product: Product;
  compact?: boolean;
};

export function ProductArt({ product, compact = false }: ProductArtProps) {
  return (
    <span
      className={clsx("product-art", product.imageTone, compact && "compact")}
    >
      <span>{getProductInitial(product.name)}</span>
    </span>
  );
}
