import type { Product } from "@/lib/types";

export const categories = ["Todos", "Stickers", "Prints", "Pins", "Accesorios"];

const now = new Date().toISOString();

export const starterProducts: Product[] = [
  {
    id: "prod-glitter-print",
    name: "Glitter Print",
    priceCents: 4000,
    costCents: 1500,
    category: "Prints",
    imageTone: "aurora",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-mascot-sticker",
    name: "Mascot Sticker",
    priceCents: 1500,
    costCents: 350,
    category: "Stickers",
    imageTone: "coral",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-character-keychain",
    name: "Character Keychain",
    priceCents: 2500,
    costCents: 900,
    category: "Accesorios",
    imageTone: "linen",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-accesorio-pin",
    name: "Accesorio Pin",
    priceCents: 1200,
    costCents: null,
    category: "Pins",
    imageTone: "violet",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "prod-festival-tote",
    name: "Festival Tote",
    priceCents: 12000,
    costCents: 5200,
    category: "Accesorios",
    imageTone: "warm",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
];
