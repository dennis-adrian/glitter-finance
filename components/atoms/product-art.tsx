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
          // A CORS request, so the service worker can cache the photo for
          // offline tiles (app/sw.ts); Storage allows any origin.
          crossOrigin="anonymous"
          // Intrinsic size in the tile's proportions; CSS sets the real one.
          width={thumb ? 40 : compact ? 58 : 339}
          height={thumb ? 40 : compact ? 58 : 300}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <span>{getProductInitial(product.name)}</span>
      )}
    </span>
  );
}
