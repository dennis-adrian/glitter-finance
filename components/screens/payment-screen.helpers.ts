import { parseBolivianos } from "@/lib/money";

export function parseCustomDiscount(input: string, subtotal: number) {
  if (input.includes("%")) {
    return Math.round(
      (subtotal * Number.parseFloat(input.replace("%", ""))) / 100
    );
  }

  return parseBolivianos(input);
}
