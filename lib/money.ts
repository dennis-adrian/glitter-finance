export function formatBs(cents: number, compact = false) {
  const value = cents / 100;
  const hasDecimals = Math.abs(cents % 100) > 0;
  const formatted = new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);

  return compact ? `${formatted} Bs` : `Bs ${formatted}`;
}

export function parseBolivianos(input: string) {
  const normalized = input.replace(/[^\d.,]/g, "").replace(",", ".");
  const number = Number.parseFloat(normalized);

  if (Number.isNaN(number) || number < 0) {
    return 0;
  }

  return Math.round(number * 100);
}

export function clampDiscount(discountCents: number, subtotalCents: number) {
  return Math.min(Math.max(0, discountCents), subtotalCents);
}
