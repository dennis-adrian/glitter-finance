"use client";

// The draft cart in local-only mode (no PowerSync, so no local SQLite store):
// one localStorage entry, which the local data teardown removes at logout or
// when another account uses this browser. Storage can be blocked or full
// (private windows, site data settings); the cart then just is not kept, and
// the app works as before.

import {
  isFreshDraftCart,
  normalizeDraftCartLines,
  type DraftCart,
  type DraftCartStorage,
} from "@/lib/draft-cart";

export const BROWSER_DRAFT_CART_KEY = "glitter-pos-draft-cart-v1";

const emptyDraftCart: DraftCart = { cart: [], updatedAt: null };

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readDraftCart(storage: Storage): DraftCart {
  const raw = storage.getItem(BROWSER_DRAFT_CART_KEY);
  if (!raw) {
    return emptyDraftCart;
  }
  try {
    const saved = JSON.parse(raw) as { lines?: unknown; updatedAt?: unknown };
    const updatedAt =
      typeof saved.updatedAt === "string" ? saved.updatedAt : null;
    if (isFreshDraftCart(updatedAt)) {
      return { cart: normalizeDraftCartLines(saved.lines), updatedAt };
    }
  } catch {
    // Unreadable: dropped below, like a stale draft.
  }
  storage.removeItem(BROWSER_DRAFT_CART_KEY);
  return emptyDraftCart;
}

export function browserDraftCartStorage(): DraftCartStorage {
  return {
    load: async () => {
      const storage = localStorageOrNull();
      try {
        return storage ? readDraftCart(storage) : emptyDraftCart;
      } catch (error) {
        console.warn("[draft cart] could not be read", error);
        return emptyDraftCart;
      }
    },
    save: async (cart, updatedAt) => {
      const storage = localStorageOrNull();
      try {
        if (!cart.length || !updatedAt || !isFreshDraftCart(updatedAt)) {
          storage?.removeItem(BROWSER_DRAFT_CART_KEY);
          return;
        }
        storage?.setItem(
          BROWSER_DRAFT_CART_KEY,
          JSON.stringify({ lines: normalizeDraftCartLines(cart), updatedAt })
        );
      } catch (error) {
        console.warn("[draft cart] could not be saved", error);
      }
    },
    clear: async () => {
      try {
        localStorageOrNull()?.removeItem(BROWSER_DRAFT_CART_KEY);
      } catch (error) {
        console.warn("[draft cart] could not be cleared", error);
      }
    },
  };
}
