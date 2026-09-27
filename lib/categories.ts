// The product categories the editor offers and the category rails filter by.
// "Todos" is the rails' show-everything filter, never a stored category.
/** The category filter that shows every product. */
export const ALL_CATEGORIES = "Todos";

export const categories = [
  ALL_CATEGORIES,
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
