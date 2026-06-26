import { parseBolivianos } from "@/lib/money";

export function hasValidProductForm(name: string, price: string) {
  return Boolean(name.trim()) && parseBolivianos(price) > 0;
}

/** Whole positive integers only — rejects decimals and trailing junk. */
export function parsePositiveInteger(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

/** Non-zero whole integers only — rejects decimals and trailing junk. */
export function parseSignedInteger(value: string) {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed !== 0 ? parsed : null;
}
