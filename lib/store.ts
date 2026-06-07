"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { starterProducts } from "@/lib/sample-data";
import type { CartLine, Product, ProductInput, Sale } from "@/lib/types";

const draftCartMaxAgeMs = 24 * 60 * 60 * 1000;

type PosState = {
  products: Product[];
  cart: CartLine[];
  cartUpdatedAt: string | null;
  sales: Sale[];
  hydrateProducts: (products: Product[]) => void;
  hydrateSales: (sales: Sale[]) => void;
  upsertProduct: (product: Product) => void;
  addProduct: (input: ProductInput) => void;
  updateProduct: (id: string, input: ProductInput) => void;
  archiveProduct: (id: string) => void;
  restoreProduct: (id: string) => void;
  addToCart: (productId: string) => void;
  decrementCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  setLineDiscount: (
    productId: string,
    lineDiscountCents: number,
    lineDiscountReason?: string
  ) => void;
  clearCart: () => void;
  recordSale: (sale: Sale) => void;
  upsertSale: (sale: Sale) => void;
  resetDemo: () => void;
};

function nowIso() {
  return new Date().toISOString();
}

function isFreshDraftCart(updatedAt: string | null | undefined) {
  return Boolean(
    updatedAt && Date.now() - new Date(updatedAt).getTime() < draftCartMaxAgeMs
  );
}

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const usePosStore = create<PosState>()(
  persist(
    (set) => ({
      products: starterProducts,
      cart: [],
      cartUpdatedAt: null,
      sales: [],
      hydrateProducts: (products) =>
        set((state) => ({
          products,
          cart: isFreshDraftCart(state.cartUpdatedAt)
            ? state.cart.filter((line) =>
                products.some(
                  (product) =>
                    product.id === line.productId && !product.archivedAt
                )
              )
            : [],
          cartUpdatedAt: isFreshDraftCart(state.cartUpdatedAt)
            ? state.cartUpdatedAt
            : null,
        })),
      hydrateSales: (sales) => set({ sales }),
      upsertProduct: (product) =>
        set((state) => {
          const exists = state.products.some((item) => item.id === product.id);
          return {
            products: exists
              ? state.products.map((item) =>
                  item.id === product.id ? product : item
                )
              : [product, ...state.products],
            cart: product.archivedAt
              ? state.cart.filter((line) => line.productId !== product.id)
              : state.cart,
          };
        }),
      addProduct: (input) =>
        set((state) => {
          const now = nowIso();
          return {
            products: [
              {
                id: id("prod"),
                name: input.name,
                priceCents: input.priceCents,
                costCents: input.costCents,
                category: input.category,
                imagePath: `placeholder:${input.imageTone ?? "violet"}`,
                imageTone: input.imageTone ?? "violet",
                archivedAt: null,
                createdAt: now,
                updatedAt: now,
              },
              ...state.products,
            ],
          };
        }),
      updateProduct: (productId, input) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  name: input.name,
                  priceCents: input.priceCents,
                  costCents: input.costCents,
                  category: input.category,
                  imagePath: `placeholder:${input.imageTone ?? product.imageTone}`,
                  imageTone: input.imageTone ?? product.imageTone,
                  updatedAt: nowIso(),
                }
              : product
          ),
        })),
      archiveProduct: (productId) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId
              ? { ...product, archivedAt: nowIso() }
              : product
          ),
          cart: state.cart.filter((line) => line.productId !== productId),
          cartUpdatedAt: state.cart.some((line) => line.productId === productId)
            ? nowIso()
            : state.cartUpdatedAt,
        })),
      restoreProduct: (productId) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId
              ? { ...product, archivedAt: null }
              : product
          ),
        })),
      addToCart: (productId) =>
        set((state) => {
          const product = state.products.find(
            (item) => item.id === productId && !item.archivedAt
          );
          if (!product) {
            return state;
          }

          const existing = state.cart.find(
            (line) => line.productId === productId
          );
          return {
            cart: existing
              ? state.cart.map((line) =>
                  line.productId === productId
                    ? { ...line, quantity: line.quantity + 1 }
                    : line
                )
              : [...state.cart, { productId, quantity: 1 }],
            cartUpdatedAt: nowIso(),
          };
        }),
      decrementCart: (productId) =>
        set((state) => ({
          cart: state.cart
            .map((line) =>
              line.productId === productId
                ? { ...line, quantity: line.quantity - 1 }
                : line
            )
            .filter((line) => line.quantity > 0),
          cartUpdatedAt: nowIso(),
        })),
      removeFromCart: (productId) =>
        set((state) => ({
          cart: state.cart.filter((line) => line.productId !== productId),
          cartUpdatedAt: nowIso(),
        })),
      setLineDiscount: (productId, lineDiscountCents, lineDiscountReason) =>
        set((state) => ({
          cart: state.cart.map((line) =>
            line.productId === productId
              ? {
                  ...line,
                  lineDiscountCents: Math.max(0, lineDiscountCents),
                  lineDiscountReason: lineDiscountReason?.trim() || undefined,
                }
              : line
          ),
          cartUpdatedAt: nowIso(),
        })),
      clearCart: () => set({ cart: [], cartUpdatedAt: null }),
      recordSale: (sale) =>
        set((state) => ({
          sales: [
            sale,
            ...state.sales.filter((existing) => existing.id !== sale.id),
          ],
          cart: [],
          cartUpdatedAt: null,
        })),
      upsertSale: (sale) =>
        set((state) => ({
          sales: state.sales.some((existing) => existing.id === sale.id)
            ? state.sales.map((existing) =>
                existing.id === sale.id ? sale : existing
              )
            : [sale, ...state.sales],
        })),
      resetDemo: () =>
        set({
          products: starterProducts,
          cart: [],
          cartUpdatedAt: null,
          sales: [],
        }),
    }),
    {
      name: "glitter-pos-local-v1",
      version: 2,
      partialize: (state) => ({
        cart: state.cart,
        cartUpdatedAt: state.cartUpdatedAt,
      }),
      migrate: (persistedState) => {
        const state =
          persistedState && typeof persistedState === "object"
            ? (persistedState as Partial<PosState>)
            : {};

        if (!isFreshDraftCart(state.cartUpdatedAt)) {
          return { cart: [], cartUpdatedAt: null };
        }

        return {
          cart: Array.isArray(state.cart) ? state.cart : [],
          cartUpdatedAt: state.cartUpdatedAt ?? null,
        };
      },
    }
  )
);
