// The draft cart: the cart in progress, kept on the device so a reload or a
// closed tab does not lose a sale being rung up. PowerSync mode keeps it in
// the local SQLite store (lib/powersync/draft-cart.ts); local-only mode, which
// has no such store, in this browser's localStorage
// (lib/browser-draft-cart.ts). A draft older than a day is discarded.

import type { CartLine } from "@/lib/types";

export const DRAFT_CART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type DraftCart = { cart: CartLine[]; updatedAt: string | null };

/** Where the app loads and saves the draft cart. */
export type DraftCartStorage = {
  load: () => Promise<DraftCart>;
  /** An empty or stale cart clears the saved draft. */
  save: (cart: CartLine[], updatedAt: string | null) => Promise<void>;
  clear: () => Promise<void>;
};

export function isFreshDraftCart(updatedAt: string | null | undefined) {
  return Boolean(
    updatedAt &&
    Date.now() - new Date(updatedAt).getTime() < DRAFT_CART_MAX_AGE_MS
  );
}

/** The well-formed lines of a saved cart; anything else is dropped. */
export function normalizeDraftCartLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((line): CartLine | null => {
      if (!line || typeof line !== "object") {
        return null;
      }

      const candidate = line as Partial<CartLine>;
      const quantity = candidate.quantity;
      if (
        typeof candidate.productId !== "string" ||
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return null;
      }

      return {
        productId: candidate.productId,
        quantity,
        lineDiscountCents:
          typeof candidate.lineDiscountCents === "number"
            ? candidate.lineDiscountCents
            : undefined,
        lineDiscountReason:
          typeof candidate.lineDiscountReason === "string"
            ? candidate.lineDiscountReason
            : undefined,
      };
    })
    .filter((line): line is CartLine => Boolean(line));
}
