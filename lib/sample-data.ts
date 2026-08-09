import type { Product } from "@/lib/types";

export const categories = [
  "Todos",
  "Stickers",
  "Prints",
  "Pines",
  "Accesorios",
];

const legacyCategoryMap: Record<string, string> = {
  Pegatina: "Stickers",
  Pegatinas: "Stickers",
  Lámina: "Prints",
  Láminas: "Prints",
  Pins: "Pines",
};

/** Normaliza categorías históricas para que coincidan con los filtros actuales. */
export function canonicalizeCategory(category: string) {
  return legacyCategoryMap[category] ?? category;
}

const now = new Date().toISOString();

export const starterProducts: Product[] = [
  {
    id: "prod-lamina-ilustrada",
    name: "Print ilustrado",
    priceCents: 4000,
    costCents: 1500,
    category: "Prints",
    imagePath: "placeholder:aurora",
    imageUrl: null,
    imageTone: "aurora",
    tracksInventory: false,
    lowStockThreshold: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-pegatina-mascota",
    name: "Sticker de mascota",
    priceCents: 1500,
    costCents: 350,
    category: "Stickers",
    imagePath: "placeholder:coral",
    imageUrl: null,
    imageTone: "coral",
    tracksInventory: false,
    lowStockThreshold: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-llavero-personaje",
    name: "Llavero de personaje",
    priceCents: 2500,
    costCents: 900,
    category: "Accesorios",
    imagePath: "placeholder:linen",
    imageUrl: null,
    imageTone: "linen",
    tracksInventory: false,
    lowStockThreshold: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-accesorio-pin",
    name: "Pin decorativo",
    priceCents: 1200,
    costCents: null,
    category: "Pines",
    imagePath: "placeholder:violet",
    imageUrl: null,
    imageTone: "violet",
    tracksInventory: false,
    lowStockThreshold: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-bolsa-feria",
    name: "Bolsa de feria",
    priceCents: 12000,
    costCents: 5200,
    category: "Accesorios",
    imagePath: "placeholder:warm",
    imageUrl: null,
    imageTone: "warm",
    tracksInventory: false,
    lowStockThreshold: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
];
