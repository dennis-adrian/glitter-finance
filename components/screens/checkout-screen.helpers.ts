// Bolivian bills. Coins (1, 2, 5 Bs) are left to the "Otro monto" field.
const CASH_BILLS_CENTS = [2000, 5000, 10000, 20000];

/**
 * Likely amounts a customer hands over: the total rounded up to each bill,
 * keeping the three smallest distinct values above the exact total.
 */
export function suggestCashAmounts(totalCents: number, limit = 3) {
  if (totalCents <= 0) return [];

  const amounts = new Set<number>();
  for (const bill of CASH_BILLS_CENTS) {
    const rounded = Math.ceil(totalCents / bill) * bill;
    if (rounded > totalCents) amounts.add(rounded);
  }

  return [...amounts].sort((a, b) => a - b).slice(0, limit);
}

export type CashTender =
  | { state: "exact" }
  | { state: "short"; missingCents: number }
  | { state: "change"; changeCents: number };

/** `receivedCents` null means the seller didn't enter an amount (exact). */
export function evaluateCashTender(
  totalCents: number,
  receivedCents: number | null
): CashTender {
  if (receivedCents == null || receivedCents === totalCents) {
    return { state: "exact" };
  }
  if (receivedCents < totalCents) {
    return { state: "short", missingCents: totalCents - receivedCents };
  }
  return { state: "change", changeCents: receivedCents - totalCents };
}

/**
 * Whether a discount preset shows as selected: its amount is applied and the
 * custom amount panel is closed. Tapping a selected preset removes the
 * discount; tapping any other applies its amount.
 */
export function isDiscountPresetPressed(
  discountCents: number,
  presetCents: number,
  customOpen: boolean
) {
  return discountCents === presetCents && !customOpen;
}
