import { parseBolivianos } from "@/lib/money";

export function hasValidProductForm(name: string, price: string) {
  return Boolean(name.trim()) && parseBolivianos(price) > 0;
}
