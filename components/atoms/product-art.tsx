"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { getProductInitial } from "@/lib/products";
import type { Product } from "@/lib/types";

type ProductArtProps = {
  product: Product;
  /** 58px square for order lines. */
  compact?: boolean;
  /** 40px square for table rows. */
  thumb?: boolean;
};

export function ProductArt({
  product,
  compact = false,
  thumb = false,
}: ProductArtProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageUrl =
    product.imageUrl && product.imageUrl !== failedImageUrl
      ? product.imageUrl
      : null;

  useEffect(() => {
    setFailedImageUrl(null);
  }, [product.imageUrl]);

  return (
    <span
      className={clsx(
        "product-art",
        product.imageTone,
        imageUrl && "has-image",
        compact && "compact",
        thumb && "thumb"
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={product.name}
          draggable={false}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <span>{getProductInitial(product.name)}</span>
      )}
    </span>
  );
}
