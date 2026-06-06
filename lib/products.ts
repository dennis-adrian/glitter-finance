import type { Product } from "@/lib/types";

export const emptyProduct: Product = {
  id: "draft",
  name: "Producto",
  priceCents: 0,
  costCents: null,
  category: "Stickers",
  imageTone: "violet",
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
};

export function getProductInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "G";
}
