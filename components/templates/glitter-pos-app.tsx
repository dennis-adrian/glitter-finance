"use client";

import { useMemo, useState } from "react";
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

export function GlitterPosApp() {
  const products = usePosStore((state) => state.products);
  const cart = usePosStore((state) => state.cart);
  const sales = usePosStore((state) => state.sales);
  const addToCart = usePosStore((state) => state.addToCart);
  const decrementCart = usePosStore((state) => state.decrementCart);
  const removeFromCart = usePosStore((state) => state.removeFromCart);
  const clearCart = usePosStore((state) => state.clearCart);
  const commitSale = usePosStore((state) => state.commitSale);
  const addProduct = usePosStore((state) => state.addProduct);
  const updateProduct = usePosStore((state) => state.updateProduct);
  const archiveProduct = usePosStore((state) => state.archiveProduct);
  const restoreProduct = usePosStore((state) => state.restoreProduct);
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

  const activeProducts = products.filter((product) => !product.archivedAt);
  const cartDetails = useMemo(
    () =>
      cart
        .map((line) => {
          const product = products.find((item) => item.id === line.productId);
          return product ? { ...line, product } : null;
        })
        .filter((line): line is { productId: string; quantity: number; product: Product } => Boolean(line)),
    [cart, products],
  );
  const cartSubtotal = cartDetails.reduce((total, line) => total + line.product.priceCents * line.quantity, 0);
  const cartCount = cartDetails.reduce((total, line) => total + line.quantity, 0);
  const selectedSale = selectedSaleId ? (sales.find((sale) => sale.id === selectedSaleId) ?? null) : null;

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

  function handleSaveProduct(input: {
    name: string;
    priceCents: number;
    costCents: number | null;
    category: string;
    imageTone: string;
  }) {
    if (editingProduct) {
      updateProduct(editingProduct.id, input);
      showToast("Producto actualizado", "info");
    } else {
      addProduct(input);
      showToast("Producto agregado");
    }

    setView("products");
  }

  function handlePayment(method: PaymentMethod, discount: number, reason?: string) {
    const sale = commitSale(method, discount, reason);
    if (sale) {
      showToast(`Venta registrada · ${saleTotal(sale)} · ${paymentLabels[method]}`);
      setView("sell");
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
        restoreProduct={(productId) => {
          restoreProduct(productId);
          showToast("Producto restaurado", "info");
        }}
      />
    ),
    settings: (
      <SettingsScreen
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
    payment: <PaymentScreen subtotal={cartSubtotal} count={cartCount} back={() => setView("sell")} pay={handlePayment} />,
    editor: (
      <ProductEditor
        product={editingProduct}
        back={() => setView(previousView === "sell" ? "products" : previousView)}
        save={handleSaveProduct}
        archive={(productId) => {
          archiveProduct(productId);
          showToast("Producto archivado", "info");
          setView("products");
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
