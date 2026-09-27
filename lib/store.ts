"use client";

import { create } from "zustand";
import { isFreshDraftCart } from "@/lib/draft-cart";
import { priceLine } from "@/lib/sales/pricing";
import type { CartLine, Product, Sale } from "@/lib/types";

type PosState = {
  products: Product[];
  cart: CartLine[];
  cartUpdatedAt: string | null;
  cartRevision: number;
  sales: Sale[];
  hydrateProducts: (products: Product[]) => void;
  hydrateSales: (sales: Sale[]) => void;
  hydrateCart: (
    cart: CartLine[],
    cartUpdatedAt: string | null,
    expectedCartRevision?: number
  ) => void;
  upsertProduct: (product: Product) => void;
  addToCart: (productId: string) => void;
  decrementCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  setLineDiscount: (
    productId: string,
    lineDiscountCents: number,
    lineDiscountReason?: string
  ) => void;
  clearCart: () => void;
  restoreCart: (cart: CartLine[], expectedCartRevision: number) => void;
  clearLocalData: () => void;
  recordSale: (sale: Sale) => void;
  upsertSale: (sale: Sale) => void;
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * A line discount is an amount (a percentage resolves when it is applied), so
 * it is clamped again whenever the line's quantity or price changes: a
 * discount that no longer fits shrinks to the new line gross instead of
 * coming back in full when the quantity goes up again.
 */
function clampLineDiscount(line: CartLine, products: Product[]): CartLine {
  if (!line.lineDiscountCents) {
    return line;
  }
  const product = products.find((item) => item.id === line.productId);
  if (!product) {
    return line;
  }
  const { discountCents } = priceLine({
    priceCents: product.priceCents,
    quantity: line.quantity,
    lineDiscountCents: line.lineDiscountCents,
  });
  return discountCents === line.lineDiscountCents
    ? line
    : { ...line, lineDiscountCents: discountCents };
}

/** The lines whose product is still for sale, with their discounts refit. */
function sellableCartLines(cart: CartLine[], products: Product[]) {
  return cart
    .filter((line) =>
      products.some(
        (product) => product.id === line.productId && !product.archivedAt
      )
    )
    .map((line) => clampLineDiscount(line, products));
}

export const usePosStore = create<PosState>()((set) => ({
  // Filled from the server render, then from the local store (PowerSync).
  products: [],
  cart: [],
  cartUpdatedAt: null,
  cartRevision: 0,
  sales: [],
  hydrateProducts: (products) =>
    set((state) => ({
      products,
      cart: isFreshDraftCart(state.cartUpdatedAt)
        ? sellableCartLines(state.cart, products)
        : [],
      cartUpdatedAt: isFreshDraftCart(state.cartUpdatedAt)
        ? state.cartUpdatedAt
        : null,
    })),
  hydrateSales: (sales) => set({ sales }),
  hydrateCart: (cart, cartUpdatedAt, expectedCartRevision) =>
    set((state) => {
      if (
        expectedCartRevision !== undefined &&
        state.cartRevision !== expectedCartRevision
      ) {
        return {};
      }

      if (!isFreshDraftCart(cartUpdatedAt)) {
        return { cart: [], cartUpdatedAt: null };
      }

      return {
        cart: sellableCartLines(cart, state.products),
        cartUpdatedAt,
      };
    }),
  upsertProduct: (product) =>
    set((state) => {
      const exists = state.products.some((item) => item.id === product.id);
      const products = exists
        ? state.products.map((item) =>
            item.id === product.id ? product : item
          )
        : [product, ...state.products];
      return {
        products,
        cart: product.archivedAt
          ? state.cart.filter((line) => line.productId !== product.id)
          : state.cart.map((line) =>
              line.productId === product.id
                ? clampLineDiscount(line, products)
                : line
            ),
        cartRevision:
          product.archivedAt &&
          state.cart.some((line) => line.productId === product.id)
            ? state.cartRevision + 1
            : state.cartRevision,
      };
    }),
  addToCart: (productId) =>
    set((state) => {
      const product = state.products.find(
        (item) => item.id === productId && !item.archivedAt
      );
      if (!product) {
        return state;
      }

      const existing = state.cart.find((line) => line.productId === productId);
      return {
        cart: existing
          ? state.cart.map((line) =>
              line.productId === productId
                ? { ...line, quantity: line.quantity + 1 }
                : line
            )
          : [...state.cart, { productId, quantity: 1 }],
        cartUpdatedAt: nowIso(),
        cartRevision: state.cartRevision + 1,
      };
    }),
  decrementCart: (productId) =>
    set((state) => ({
      cart: state.cart
        .map((line) =>
          line.productId === productId
            ? clampLineDiscount(
                { ...line, quantity: line.quantity - 1 },
                state.products
              )
            : line
        )
        .filter((line) => line.quantity > 0),
      cartUpdatedAt: nowIso(),
      cartRevision: state.cartRevision + 1,
    })),
  removeFromCart: (productId) =>
    set((state) => ({
      cart: state.cart.filter((line) => line.productId !== productId),
      cartUpdatedAt: nowIso(),
      cartRevision: state.cartRevision + 1,
    })),
  setLineDiscount: (productId, lineDiscountCents, lineDiscountReason) =>
    set((state) => ({
      cart: state.cart.map((line) => {
        if (line.productId !== productId) {
          return line;
        }

        // Clamped to 0..line gross, so the stored value never exceeds what
        // can actually be discounted.
        return clampLineDiscount(
          {
            ...line,
            lineDiscountCents: Math.max(0, Math.round(lineDiscountCents) || 0),
            lineDiscountReason: lineDiscountReason?.trim() || undefined,
          },
          state.products
        );
      }),
      cartUpdatedAt: nowIso(),
      cartRevision: state.cartRevision + 1,
    })),
  clearCart: () =>
    set((state) => ({
      cart: [],
      cartUpdatedAt: null,
      cartRevision: state.cartRevision + 1,
    })),
  // Undo for clearCart: puts the emptied lines back, unless the cart changed
  // since (a line added after emptying it is kept, not overwritten).
  restoreCart: (cart, expectedCartRevision) =>
    set((state) => {
      if (state.cartRevision !== expectedCartRevision) {
        return {};
      }
      return {
        cart: sellableCartLines(cart, state.products),
        cartUpdatedAt: nowIso(),
        cartRevision: state.cartRevision + 1,
      };
    }),
  clearLocalData: () =>
    set((state) => ({
      products: [],
      cart: [],
      cartUpdatedAt: null,
      cartRevision: state.cartRevision + 1,
      sales: [],
    })),
  recordSale: (sale) =>
    set((state) => ({
      sales: [
        sale,
        ...state.sales.filter((existing) => existing.id !== sale.id),
      ],
      cart: [],
      cartUpdatedAt: null,
      cartRevision: state.cartRevision + 1,
    })),
  upsertSale: (sale) =>
    set((state) => ({
      sales: state.sales.some((existing) => existing.id === sale.id)
        ? state.sales.map((existing) =>
            existing.id === sale.id ? sale : existing
          )
        : [sale, ...state.sales],
    })),
}));
