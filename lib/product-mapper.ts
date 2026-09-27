import type { Product } from "@/lib/types";
import { canonicalizeCategory } from "@/lib/categories";
import {
  placeholderImageTone,
  placeholderImageTones,
} from "@/lib/product-image-config";
import { getProductImagePublicUrl } from "@/lib/product-images";

type DbProduct = {
  id: string;
  name: string;
  priceCents: number;
  costCents: number | null;
  category: string;
  imagePath: string | null;
  tracksInventory?: boolean | number | null;
  lowStockThreshold?: number | null;
  archivedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function deriveImageTone(seed: string) {
  const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return placeholderImageTones[total % placeholderImageTones.length];
}

// Uploaded images (and unknown tones) get a tone derived from the product,
// which the tile shows when the image cannot load.
function imageToneFromPath(path: string | null, fallbackSeed: string) {
  return placeholderImageTone(path) ?? deriveImageTone(fallbackSeed);
}

export function mapDbProductToProduct(product: DbProduct): Product {
  return {
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
    costCents: product.costCents,
    category: canonicalizeCategory(product.category),
    imagePath: product.imagePath,
    imageUrl: getProductImagePublicUrl(product.imagePath),
    imageTone: imageToneFromPath(
      product.imagePath,
      `${product.id}-${product.category}`
    ),
    tracksInventory: Boolean(product.tracksInventory),
    lowStockThreshold: product.lowStockThreshold ?? null,
    archivedAt: product.archivedAt ? toIso(product.archivedAt) : null,
    createdAt: toIso(product.createdAt),
    updatedAt: toIso(product.updatedAt),
  };
}
