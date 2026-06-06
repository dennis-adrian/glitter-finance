"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clampDiscount } from "@/lib/money";
import { starterProducts } from "@/lib/sample-data";
import type { CartLine, PaymentMethod, Product, Sale, SaleLine } from "@/lib/types";

const tenantId = "tenant-glitter-demo";
const defaultUser = {
  id: "user-adrian",
  name: "Adrian",
};

type ProductInput = {
  name: string;
  priceCents: number;
  costCents: number | null;
  category: string;
  imageTone?: string;
};

type PosState = {
  products: Product[];
  cart: CartLine[];
  sales: Sale[];
  currentUser: typeof defaultUser;
  addProduct: (input: ProductInput) => void;
  updateProduct: (id: string, input: ProductInput) => void;
  archiveProduct: (id: string) => void;
  restoreProduct: (id: string) => void;
  addToCart: (productId: string) => void;
  decrementCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  commitSale: (paymentMethod: PaymentMethod, saleDiscountCents: number, reason?: string) => Sale | null;
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

function cartSubtotal(products: Product[], cart: CartLine[]) {
  return cart.reduce((total, line) => {
    const product = products.find((item) => item.id === line.productId);
    return total + (product?.priceCents ?? 0) * line.quantity;
  }, 0);
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      products: starterProducts,
      cart: [],
      sales: [],
      currentUser: defaultUser,
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
              : product,
          ),
        })),
      archiveProduct: (productId) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId ? { ...product, archivedAt: new Date().toISOString() } : product,
          ),
          cart: state.cart.filter((line) => line.productId !== productId),
        })),
      restoreProduct: (productId) =>
        set((state) => ({
          products: state.products.map((product) =>
            product.id === productId ? { ...product, archivedAt: null } : product,
          ),
        })),
      addToCart: (productId) =>
        set((state) => {
          const product = state.products.find((item) => item.id === productId && !item.archivedAt);
          if (!product) {
            return state;
          }

          const existing = state.cart.find((line) => line.productId === productId);
          return {
            cart: existing
              ? state.cart.map((line) =>
                  line.productId === productId ? { ...line, quantity: line.quantity + 1 } : line,
                )
              : [...state.cart, { productId, quantity: 1 }],
          };
        }),
      decrementCart: (productId) =>
        set((state) => ({
          cart: state.cart
            .map((line) => (line.productId === productId ? { ...line, quantity: line.quantity - 1 } : line))
            .filter((line) => line.quantity > 0),
        })),
      removeFromCart: (productId) =>
        set((state) => ({
          cart: state.cart.filter((line) => line.productId !== productId),
        })),
      clearCart: () => set({ cart: [] }),
      commitSale: (paymentMethod, saleDiscountCents, reason) => {
        const state = get();
        const subtotal = cartSubtotal(state.products, state.cart);
        const discount = clampDiscount(saleDiscountCents, subtotal);

        if (state.cart.length === 0 || subtotal <= 0) {
          return null;
        }

        const saleLines: SaleLine[] = state.cart
          .map((line) => {
            const product = state.products.find((item) => item.id === line.productId);
            if (!product) {
              return null;
            }

            return {
              id: id("line"),
              productId: product.id,
              productName: product.name,
              category: product.category,
              quantity: line.quantity,
              unitPriceCents: product.priceCents,
              unitCostCents: product.costCents,
              lineDiscountCents: 0,
            };
          })
          .filter((line): line is SaleLine => Boolean(line));

        const sale: Sale = {
          id: id("sale"),
          tenantId,
          userId: state.currentUser.id,
          userName: state.currentUser.name,
          createdAt: new Date().toISOString(),
          paymentMethod,
          saleDiscountCents: discount,
          saleDiscountReason: reason,
          lines: saleLines,
          status: "completed",
        };

        set((current) => ({
          sales: [sale, ...current.sales],
          cart: [],
        }));

        return sale;
      },
      voidSale: (saleId) =>
        set((state) => ({
          sales: state.sales.map((sale) =>
            sale.id === saleId && sale.status === "completed"
              ? { ...sale, status: "voided", voidedAt: new Date().toISOString() }
              : sale,
          ),
        })),
      refundSale: (saleId) =>
        set((state) => {
          const original = state.sales.find((sale) => sale.id === saleId && sale.status === "completed");
          const alreadyRefunded = state.sales.some((sale) => sale.refundOfSaleId === saleId);
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
      resetDemo: () => set({ products: starterProducts, cart: [], sales: [], currentUser: defaultUser }),
    }),
    {
      name: "glitter-pos-local-v1",
      version: 1,
    },
  ),
);
