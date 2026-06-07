"use client";

import { useEffect, useMemo, useState } from "react";
import {
  archiveProduct as archiveProductAction,
  createProduct,
  restoreProduct as restoreProductAction,
  updateProduct as updateProductAction,
} from "@/app/products/actions";
import { createSale } from "@/app/sales/actions";
import { Toast } from "@/components/atoms/toast";
import { BottomNav } from "@/components/organisms/bottom-nav";
import { CartScreen } from "@/components/screens/cart-screen";
import { PaymentScreen } from "@/components/screens/payment-screen";
import { ProductEditor } from "@/components/screens/product-editor";
import { ProductsScreen } from "@/components/screens/products-screen";
import { ReportsScreen } from "@/components/screens/reports-screen";
import { SaleDetailScreen } from "@/components/screens/sale-detail-screen";
import { SellScreen } from "@/components/screens/sell-screen";
import { SettingsScreen } from "@/components/screens/settings-screen";
import { paymentLabels, saleTotal } from "@/lib/sales";
import { usePosStore } from "@/lib/store";
import type { PaymentMethod, Product, ToastMessage } from "@/lib/types";
import type { View } from "@/lib/views";
import type { UserTenantContext } from "@/lib/auth/user-context";

type GlitterPosAppProps = {
  tenantContext: UserTenantContext;
  initialProducts: Product[];
};

export function GlitterPosApp({
  tenantContext,
  initialProducts,
}: GlitterPosAppProps) {
  const products = usePosStore((state) => state.products);
  const cart = usePosStore((state) => state.cart);
  const sales = usePosStore((state) => state.sales);
  const addToCart = usePosStore((state) => state.addToCart);
  const decrementCart = usePosStore((state) => state.decrementCart);
  const removeFromCart = usePosStore((state) => state.removeFromCart);
  const clearCart = usePosStore((state) => state.clearCart);
  const recordSale = usePosStore((state) => state.recordSale);
  const hydrateProducts = usePosStore((state) => state.hydrateProducts);
  const upsertProduct = usePosStore((state) => state.upsertProduct);
  const voidSale = usePosStore((state) => state.voidSale);
  const refundSale = usePosStore((state) => state.refundSale);
  const resetDemo = usePosStore((state) => state.resetDemo);

  const [view, setView] = useState<View>("sell");
  const [previousView, setPreviousView] = useState<View>("products");
  const [category, setCategory] = useState("Todos");
  const [catalogCategory, setCatalogCategory] = useState("Todos");
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const activeProducts = products.filter((product) => !product.archivedAt);
  const cartDetails = useMemo(
    () =>
      cart
        .map((line) => {
          const product = products.find((item) => item.id === line.productId);
          return product ? { ...line, product } : null;
        })
        .filter(
          (
            line
          ): line is {
            productId: string;
            quantity: number;
            product: Product;
          } => Boolean(line)
        ),
    [cart, products]
  );
  const cartSubtotal = cartDetails.reduce(
    (total, line) => total + line.product.priceCents * line.quantity,
    0
  );
  const cartCount = cartDetails.reduce(
    (total, line) => total + line.quantity,
    0
  );
  const selectedSale = selectedSaleId
    ? (sales.find((sale) => sale.id === selectedSaleId) ?? null)
    : null;

  useEffect(() => {
    hydrateProducts(initialProducts);
  }, [hydrateProducts, initialProducts]);

  function showToast(text: string, tone: ToastMessage["tone"] = "success") {
    const message = { id: `${Date.now()}`, text, tone };
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current?.id === message.id ? null : current));
    }, 2600);
  }

  function openEditor(product: Product | null) {
    setPreviousView(view === "editor" ? "products" : view);
    setEditingProduct(product);
    setView("editor");
  }

  async function handleSaveProduct(input: {
    name: string;
    priceCents: number;
    costCents: number | null;
    category: string;
    imageTone: string;
  }) {
    try {
      const product = editingProduct
        ? await updateProductAction(editingProduct.id, input)
        : await createProduct(input);
      upsertProduct(product);
      showToast(
        editingProduct ? "Producto actualizado" : "Producto agregado",
        editingProduct ? "info" : "success"
      );
      setView("products");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el producto",
        "danger"
      );
    }
  }

  async function handlePayment(
    method: PaymentMethod,
    discount: number,
    reason?: string
  ) {
    if (isCheckingOut || !cartDetails.length) {
      return;
    }

    setIsCheckingOut(true);

    try {
      const sale = await createSale({
        paymentMethod: method,
        saleDiscountCents: discount,
        saleDiscountReason: reason,
        lines: cartDetails.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
      });
      recordSale(sale);
      showToast(
        `Venta registrada · ${saleTotal(sale)} · ${paymentLabels[method]}`
      );
      setView("sell");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "No se pudo registrar la venta",
        "danger"
      );
    } finally {
      setIsCheckingOut(false);
    }
  }

  function openSaleDetail(saleId: string) {
    setSelectedSaleId(saleId);
    setView("saleDetail");
  }

  const content = {
    sell: (
      <SellScreen
        products={activeProducts}
        cartCount={cartCount}
        cartSubtotal={cartSubtotal}
        cart={cart}
        category={category}
        query={query}
        setCategory={setCategory}
        setQuery={setQuery}
        addToCart={addToCart}
        decrementCart={decrementCart}
        openCart={() => setView("cart")}
        openPayment={() => setView("payment")}
      />
    ),
    reports: (
      <ReportsScreen
        sales={sales}
        openSale={openSaleDetail}
        voidSale={(saleId) => {
          voidSale(saleId);
          showToast("Venta anulada", "info");
        }}
        refundSale={(saleId) => {
          refundSale(saleId);
          showToast("Reembolso registrado", "info");
        }}
      />
    ),
    products: (
      <ProductsScreen
        products={products}
        category={catalogCategory}
        query={catalogQuery}
        setCategory={setCatalogCategory}
        setQuery={setCatalogQuery}
        openEditor={openEditor}
        restoreProduct={async (productId) => {
          try {
            const product = await restoreProductAction(productId);
            upsertProduct(product);
            showToast("Producto restaurado", "info");
          } catch (error) {
            showToast(
              error instanceof Error
                ? error.message
                : "No se pudo restaurar el producto",
              "danger"
            );
          }
        }}
      />
    ),
    settings: (
      <SettingsScreen
        tenantContext={tenantContext}
        productCount={activeProducts.length}
        saleCount={sales.filter((sale) => sale.status === "completed").length}
        pendingCount={sales.length}
        resetDemo={() => {
          resetDemo();
          showToast("Datos demo restaurados", "info");
          setView("sell");
        }}
      />
    ),
    cart: (
      <CartScreen
        cartDetails={cartDetails}
        subtotal={cartSubtotal}
        decrementCart={decrementCart}
        addToCart={addToCart}
        removeFromCart={removeFromCart}
        clearCart={() => {
          clearCart();
          showToast("Carrito vaciado", "info");
          setView("sell");
        }}
        back={() => setView("sell")}
        charge={() => setView("payment")}
      />
    ),
    payment: (
      <PaymentScreen
        subtotal={cartSubtotal}
        count={cartCount}
        back={() => setView("sell")}
        pay={handlePayment}
        isSubmitting={isCheckingOut}
      />
    ),
    editor: (
      <ProductEditor
        product={editingProduct}
        back={() =>
          setView(previousView === "sell" ? "products" : previousView)
        }
        save={handleSaveProduct}
        archive={async (productId) => {
          try {
            const product = await archiveProductAction(productId);
            upsertProduct(product);
            showToast("Producto archivado", "info");
            setView("products");
          } catch (error) {
            showToast(
              error instanceof Error
                ? error.message
                : "No se pudo archivar el producto",
              "danger"
            );
          }
        }}
      />
    ),
    saleDetail: (
      <SaleDetailScreen
        sale={selectedSale}
        sales={sales}
        back={() => setView("reports")}
        voidSale={(saleId) => {
          voidSale(saleId);
          showToast("Venta anulada", "info");
          setView("reports");
        }}
        refundSale={(saleId) => {
          refundSale(saleId);
          showToast("Reembolso registrado", "info");
          setView("reports");
        }}
      />
    ),
  }[view];

  return (
    <main className="app-shell">
      <div className="phone-frame">
        {content}
        {["sell", "reports", "products", "settings"].includes(view) ? (
          <BottomNav view={view} setView={(nextView) => setView(nextView)} />
        ) : null}
        {toast ? <Toast toast={toast} /> : null}
      </div>
    </main>
  );
}
