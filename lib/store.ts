"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { starterProducts } from "@/lib/sample-data";
import type { CartLine, Product, ProductInput, Sale } from "@/lib/types";

const defaultUser = {
  id: "user-adrian",
  name: "Adrian",
};

type PosState = {
  products: Product[];
  cart: CartLine[];
  sales: Sale[];
  currentUser: typeof defaultUser;
  hydrateProducts: (products: Product[]) => void;
  upsertProduct: (product: Product) => void;
  addProduct: (input: ProductInput) => void;
  updateProduct: (id: string, input: ProductInput) => void;
  archiveProduct: (id: string) => void;
  restoreProduct: (id: string) => void;
  addToCart: (productId: string) => void;
  decrementCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  recordSale: (sale: Sale) => void;
  voidSale: (saleId: string) => void;
  refundSale: (saleId: string) => void;
  resetDemo: () => void;
};

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
      sales: [],
      currentUser: defaultUser,
      hydrateProducts: (products) =>
        set((state) => ({
          products,
          cart: state.cart.filter((line) =>
            products.some(
              (product) => product.id === line.productId && !product.archivedAt
            )
          ),
        })),
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
          const now = new Date().toISOString();
          return {
            products: [
              {
                id: id("prod"),
                name: input.name,
                priceCents: input.priceCents,
                costCents: input.costCents,
                category: input.category,
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
                  imageTone: input.imageTone ?? product.imageTone,
                  updatedAt: new Date().toISOString(),
                }
              : product
          ),
        })),
      archiveProduct: (productId) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId
              ? { ...product, archivedAt: new Date().toISOString() }
              : product
          ),
          cart: state.cart.filter((line) => line.productId !== productId),
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
        })),
      removeFromCart: (productId) =>
        set((state) => ({
          cart: state.cart.filter((line) => line.productId !== productId),
        })),
      clearCart: () => set({ cart: [] }),
      recordSale: (sale) =>
        set((state) => ({
          sales: [
            sale,
            ...state.sales.filter((existing) => existing.id !== sale.id),
          ],
          cart: [],
        })),
      voidSale: (saleId) =>
        set((state) => ({
          sales: state.sales.map((sale) =>
            sale.id === saleId && sale.status === "completed"
              ? {
                  ...sale,
                  status: "voided",
                  voidedAt: new Date().toISOString(),
                }
              : sale
          ),
        })),
      refundSale: (saleId) =>
        set((state) => {
          const original = state.sales.find(
            (sale) => sale.id === saleId && sale.status === "completed"
          );
          const alreadyRefunded = state.sales.some(
            (sale) => sale.refundOfSaleId === saleId
          );
          if (!original || alreadyRefunded) {
            return state;
          }

          const refund: Sale = {
            ...original,
            id: id("refund"),
            createdAt: new Date().toISOString(),
            status: "refunded",
            refundOfSaleId: original.id,
            refundedAt: new Date().toISOString(),
          };

          return {
            sales: [refund, ...state.sales],
          };
        }),
      resetDemo: () =>
        set({
          products: starterProducts,
          cart: [],
          sales: [],
          currentUser: defaultUser,
        }),
    }),
    {
      name: "glitter-pos-local-v1",
      version: 1,
    }
  )
);
