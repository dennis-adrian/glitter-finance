import { formatBs } from "@/lib/money";
import type { Product } from "@/lib/types";

/** The name and price under a product card's picture. */
export function ProductNamePrice({ product }: { product: Product }) {
  return (
    <div className="px-3 pt-2.5 pb-3.5">
      <span className="block text-[15px] leading-tight text-foreground">
        {product.name}
      </span>
      <strong className="mt-1 block text-xl leading-none font-bold text-primary">
        {formatBs(product.priceCents, true)}
      </strong>
    </div>
  );
}
