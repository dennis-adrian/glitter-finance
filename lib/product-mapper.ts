import type { Product } from "@/lib/types";
import {
  getProductImagePublicUrl,
  isPlaceholderImagePath,
  placeholderImagePrefix,
} from "@/lib/product-images";

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

const tones = ["aurora", "coral", "linen", "violet", "warm"];

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function deriveImageTone(seed: string) {
  const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

export function encodePlaceholderImagePath(tone?: string) {
  return `${placeholderImagePrefix}${tones.includes(tone ?? "") ? tone : "violet"}`;
}

function imageToneFromPath(path: string | null, fallbackSeed: string) {
  if (!isPlaceholderImagePath(path)) {
    return deriveImageTone(fallbackSeed);
  }

  if (path) {
    const tone = path.slice(placeholderImagePrefix.length);
    if (tones.includes(tone)) {
      return tone;
    }
  }

  return deriveImageTone(fallbackSeed);
}

export function mapDbProductToProduct(product: DbProduct): Product {
  return {
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
    costCents: product.costCents,
    category: product.category,
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
