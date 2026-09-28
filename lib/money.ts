import { APP_LOCALE } from "@/lib/dates";

/** Largest value a Postgres `integer` column holds. */
export const INT4_MAX = 2_147_483_647;

/**
 * Upper bound for a product's price or cost: Bs 1.000.000. Far above any real
 * price, so a larger value is a typo, and a typo left unchecked could
 * overflow the integer money columns once multiplied by a quantity.
 */
export const MAX_PRICE_CENTS = 100_000_000;

const wholeBsFormatter = new Intl.NumberFormat(APP_LOCALE, {
  maximumFractionDigits: 0,
});
const centsBsFormatter = new Intl.NumberFormat(APP_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBs(cents: number, compact = false) {
  const hasDecimals = Math.abs(cents % 100) > 0;
  const formatted = (hasDecimals ? centsBsFormatter : wholeBsFormatter).format(
    cents / 100
  );

  return compact ? `${formatted} Bs` : `Bs ${formatted}`;
}

/** Whole, non-negative cents no larger than `max`. */
export function isValidCents(
  value: unknown,
  max = MAX_PRICE_CENTS
): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
  );
}

// An amount as vendors type it: "15", "15,50", "15.5", or with the es-BO
// thousands grouping that formatBs displays, "1.500" or "1.234,50". A "." or a
// space followed by exactly three digits groups thousands; a trailing "," or
// "." with up to two digits is the decimal part. "1,500" is ambiguous (1,5 in
// es-BO, 1500 in English) and rejected.
const PLAIN_AMOUNT_RE = /^\d+(?:[.,]\d{0,2})?$/;
const GROUPED_AMOUNT_RE = /^\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d{0,2})?$/;
const DECIMAL_PART_RE = /[.,](\d{0,2})$/;
const CURRENCY_PREFIX_RE = /^bs\.?\s*/i;
const CURRENCY_SUFFIX_RE = /\s*bs\.?$/i;

/**
 * Bolivianos typed by a vendor, as whole cents, or null when the text is not
 * an amount: blank, negative, an exponent, extra characters or more than two
 * decimals. Range checks are the caller's (see isValidCents).
 */
export function parseBolivianos(input: string): number | null {
  const text = input
    .trim()
    .replace(CURRENCY_PREFIX_RE, "")
    .replace(CURRENCY_SUFFIX_RE, "");

  if (!PLAIN_AMOUNT_RE.test(text) && !GROUPED_AMOUNT_RE.test(text)) {
    return null;
  }

  const decimal = DECIMAL_PART_RE.exec(text);
  const wholePart = (decimal ? text.slice(0, decimal.index) : text).replace(
    /\D/g,
    ""
  );
  const fraction = (decimal?.[1] ?? "").padEnd(2, "0");
  const cents = Number(wholePart) * 100 + Number(fraction);

  return Number.isSafeInteger(cents) ? cents : null;
}

const PERCENT_RE = /^(\d{1,3}(?:[.,]\d{0,2})?)\s*%$/;

/**
 * A discount typed as an amount ("7", "7,50") or a percentage of
 * `subtotalCents` ("10%", "12,5%"), as whole cents. A percentage resolves to
 * an amount now, so the sale records exactly what was discounted. Blank is no
 * discount (0). Null when the text is neither, or the percentage is above 100.
 */
export function parseDiscountInput(
  input: string,
  subtotalCents: number
): number | null {
  const text = input.trim();
  if (!text) {
    return 0;
  }
  if (!text.endsWith("%")) {
    return parseBolivianos(text);
  }

  const match = PERCENT_RE.exec(text);
  if (!match) {
    return null;
  }
  const percent = Number(match[1].replace(",", "."));
  if (!(percent <= 100)) {
    return null;
  }
  const cents = Math.round((subtotalCents * percent) / 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * A discount as whole cents between 0 and the subtotal it applies to. A
 * non-finite discount (a parsing bug) is no discount at all.
 */
export function clampDiscount(discountCents: number, subtotalCents: number) {
  if (!Number.isFinite(discountCents) || !Number.isFinite(subtotalCents)) {
    return 0;
  }
  return Math.min(
    Math.max(0, Math.round(discountCents)),
    Math.max(0, subtotalCents)
  );
}
