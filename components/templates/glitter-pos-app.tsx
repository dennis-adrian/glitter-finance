"use client";

import { useEffect, useMemo, useState } from "react";
import {
  archiveProduct as archiveProductAction,
  createProduct,
  restoreProduct as restoreProductAction,
  updateProduct as updateProductAction,
  uploadProductImage,
} from "@/app/products/actions";
import {
  createSale,
  refundSale as refundSaleAction,
  voidSale as voidSaleAction,
} from "@/app/sales/actions";
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
import { clampDiscount } from "@/lib/money";
import { mapDbProductToProduct } from "@/lib/product-mapper";
import {
  buildSalesFromLocal,
  type LocalRefundRow,
  type LocalSaleLineRow,
  type LocalSaleRow,
} from "@/lib/powersync/sales-from-local";
import { usePosStore } from "@/lib/store";
import type {
  CartLine,
  PaymentMethod,
  Product,
  Sale,
  ToastMessage,
} from "@/lib/types";
import type { View } from "@/lib/views";
import type { UserTenantContext } from "@/lib/auth/user-context";
import { useOptionalPowerSyncDb } from "@/components/providers/powersync-provider";
import { SyncStatusPill } from "@/components/molecules/sync-status-pill";
import {
  createSaleLocal,
  refundSaleLocal,
  voidSaleLocal,
} from "@/lib/powersync/write-sales";
import {
  archiveProductLocal,
  createProductLocal,
  restoreProductLocal,
  updateProductLocal,
  uploadProductImageLocal,
} from "@/lib/powersync/write-products";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatBs } from "@/lib/money";

// Shape of a row coming back from the local SQLite store. Column names are
// snake_case (matching Postgres) because PowerSync replicates with the
// source column names verbatim.
type ProductRow = {
  id: string;
  name: string;
  price_cents: number;
  cost_cents: number | null;
  category: string;
  image_path: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToProduct(row: ProductRow): Product {
  return mapDbProductToProduct({
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    costCents: row.cost_cents,
    category: row.category,
    imagePath: row.image_path,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

type GlitterPosAppProps = {
  tenantContext: UserTenantContext;
  initialProducts: Product[];
  initialSales: Sale[];
};

export function GlitterPosApp({
  tenantContext,
  initialProducts,
  initialSales,
}: GlitterPosAppProps) {
  const products = usePosStore((state) => state.products);
  const cart = usePosStore((state) => state.cart);
  const sales = usePosStore((state) => state.sales);
  const addToCart = usePosStore((state) => state.addToCart);
  const decrementCart = usePosStore((state) => state.decrementCart);
  const removeFromCart = usePosStore((state) => state.removeFromCart);
  const setLineDiscount = usePosStore((state) => state.setLineDiscount);
  const clearCart = usePosStore((state) => state.clearCart);
  const recordSale = usePosStore((state) => state.recordSale);
  const upsertSale = usePosStore((state) => state.upsertSale);
  const hydrateProducts = usePosStore((state) => state.hydrateProducts);
  const hydrateSales = usePosStore((state) => state.hydrateSales);
  const upsertProduct = usePosStore((state) => state.upsertProduct);

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
        .filter((line): line is CartLine & { product: Product } =>
          Boolean(line)
        ),
    [cart, products]
  );
  const cartSubtotal = cartDetails.reduce(
    (total, line) =>
      total +
      Math.max(
        0,
        line.product.priceCents * line.quantity -
          clampDiscount(
            line.lineDiscountCents ?? 0,
            line.product.priceCents * line.quantity
          )
      ),
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
    hydrateSales(initialSales);
  }, [hydrateProducts, hydrateSales, initialProducts, initialSales]);

  // Subscribe to the local PowerSync SQLite store and push updates into
  // Zustand. Server-prop hydration above gives the first paint; this watch
  // takes over once PowerSync has finished its initial sync, then keeps the
  // UI live as new rows replicate down. We gate on `hasSynced` so the first
  // onResult doesn't fire with an empty store and wipe the server data.
  const powerSyncDb = useOptionalPowerSyncDb();
  useEffect(() => {
    if (!powerSyncDb) return;

    const controller = new AbortController();
    let unregister: (() => void) | undefined;

    function startWatching(db: NonNullable<typeof powerSyncDb>) {
      db.watch(
        "SELECT * FROM products ORDER BY created_at DESC",
        [],
        {
          onResult: (results) => {
            const rows = ((results.rows as unknown as { _array?: ProductRow[] })
              ?._array ?? []) as ProductRow[];
            hydrateProducts(rows.map(rowToProduct));
          },
          onError: (error) => {
            console.error("[PowerSync] products watch error", error);
          },
        },
        { signal: controller.signal }
      );
    }

    if (powerSyncDb.currentStatus?.hasSynced) {
      startWatching(powerSyncDb);
    } else {
      unregister = powerSyncDb.registerListener({
        statusChanged: (status) => {
          if (status.hasSynced && !controller.signal.aborted) {
            startWatching(powerSyncDb);
            unregister?.();
            unregister = undefined;
          }
        },
      });
    }

    return () => {
      controller.abort();
      unregister?.();
    };
  }, [powerSyncDb, hydrateProducts]);

  // Subscribe to sales + sale_lines + refunds. PowerSync's onChange fires
  // whenever any of the three tables mutates; we requery all three and
  // rebuild the in-memory Sale[] (same shape as the server-side
  // getSalesForTenant returns). User display names are resolved from the
  // current session — sales rung up by other tenant members fall back to a
  // generic label until tenant_users sync lands (see lib/powersync/sales-from-local.ts).
  const currentUserId = tenantContext.user.id;
  const currentUserName = tenantContext.user.displayName;
  useEffect(() => {
    if (!powerSyncDb) return;

    const controller = new AbortController();
    let unregister: (() => void) | undefined;

    function resolveUserName(userId: string) {
      return userId === currentUserId ? currentUserName : "Vendedor";
    }

    async function rebuildSales(db: NonNullable<typeof powerSyncDb>) {
      try {
        const [saleRows, lineRows, refundRows] = await Promise.all([
          db.getAll<LocalSaleRow>(
            "SELECT * FROM sales ORDER BY created_at DESC"
          ),
          db.getAll<LocalSaleLineRow>("SELECT * FROM sale_lines"),
          db.getAll<LocalRefundRow>(
            "SELECT * FROM refunds ORDER BY created_at DESC"
          ),
        ]);
        if (controller.signal.aborted) return;
        hydrateSales(
          buildSalesFromLocal(saleRows, lineRows, refundRows, resolveUserName)
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[PowerSync] sales rebuild failed", error);
        }
      }
    }

    function startWatching(db: NonNullable<typeof powerSyncDb>) {
      db.onChange(
        {
          onChange: () => rebuildSales(db),
          onError: (error) => {
            console.error("[PowerSync] sales onChange error", error);
          },
        },
        {
          signal: controller.signal,
          tables: ["sales", "sale_lines", "refunds"],
          triggerImmediate: true,
        }
      );
    }

    if (powerSyncDb.currentStatus?.hasSynced) {
      startWatching(powerSyncDb);
    } else {
      unregister = powerSyncDb.registerListener({
        statusChanged: (status) => {
          if (status.hasSynced && !controller.signal.aborted) {
            startWatching(powerSyncDb);
            unregister?.();
            unregister = undefined;
          }
        },
      });
    }

    return () => {
      controller.abort();
      unregister?.();
    };
  }, [powerSyncDb, hydrateSales, currentUserId, currentUserName]);

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
    imagePath?: string | null;
    imageFile?: File | null;
  }) {
    if (!tenantContext.tenant) {
      showToast("Tu cuenta aún no tiene un tenant.", "danger");
      return;
    }
    try {
      let uploadFailed = false;

      if (powerSyncDb) {
        // Local-first path. Metadata writes go through the local SQLite
        // store; image upload goes browser-side to Supabase Storage using
        // the user's JWT and falls back gracefully if the network is down
        // (the product is still saved without an image, per PRD §7.1).
        const productId = editingProduct
          ? (await updateProductLocal(powerSyncDb, {
              tenantId: tenantContext.tenant.id,
              productId: editingProduct.id,
              product: input,
            }),
            editingProduct.id)
          : (
              await createProductLocal(powerSyncDb, {
                tenantId: tenantContext.tenant.id,
                product: input,
              })
            ).productId;

        if (input.imageFile) {
          try {
            await uploadProductImageLocal(
              createSupabaseBrowserClient(),
              powerSyncDb,
              {
                tenantId: tenantContext.tenant.id,
                productId,
                file: input.imageFile,
              }
            );
          } catch {
            uploadFailed = true;
          }
        }
      } else {
        // Fallback: server actions during the brief window before
        // PowerSync is ready.
        let product = editingProduct
          ? await updateProductAction(editingProduct.id, input)
          : await createProduct(input);

        if (input.imageFile) {
          const formData = new FormData();
          formData.set("image", input.imageFile);
          try {
            product = await uploadProductImage(product.id, formData);
          } catch {
            uploadFailed = true;
          }
        }
        upsertProduct(product);
      }

      if (uploadFailed) {
        showToast(
          "Producto guardado, pero no se pudo subir la imagen",
          "danger"
        );
      } else {
        showToast(
          editingProduct ? "Producto actualizado" : "Producto agregado",
          editingProduct ? "info" : "success"
        );
      }
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
    if (!tenantContext.tenant) {
      showToast("Tu cuenta aún no tiene un tenant.", "danger");
      return;
    }

    setIsCheckingOut(true);

    try {
      // Local-first when PowerSync is initialized; the watch subscription
      // picks up the new rows and updates the sales list, and the upload
      // queue replicates to Supabase in the background. Fall back to the
      // server action during the brief window before PowerSync is ready.
      if (powerSyncDb) {
        await createSaleLocal(powerSyncDb, {
          tenantId: tenantContext.tenant.id,
          userId: tenantContext.user.id,
          paymentMethod: method,
          saleDiscountCents: discount,
          saleDiscountReason: reason,
          lines: cartDetails.map((line) => ({
            product: line.product,
            quantity: line.quantity,
            lineDiscountCents: line.lineDiscountCents,
            lineDiscountReason: line.lineDiscountReason,
          })),
        });
        clearCart();
        const totalCents = Math.max(0, cartSubtotal - discount);
        showToast(
          `Venta registrada · ${formatBs(totalCents, true)} · ${paymentLabels[method]}`
        );
      } else {
        const sale = await createSale({
          paymentMethod: method,
          saleDiscountCents: discount,
          saleDiscountReason: reason,
          lines: cartDetails.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            lineDiscountCents: line.lineDiscountCents,
            lineDiscountReason: line.lineDiscountReason,
          })),
        });
        recordSale(sale);
        showToast(
          `Venta registrada · ${saleTotal(sale)} · ${paymentLabels[method]}`
        );
      }
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

  async function handleVoidSale(saleId: string) {
    if (!tenantContext.tenant) {
      showToast("Tu cuenta aún no tiene un tenant.", "danger");
      return false;
    }
    try {
      if (powerSyncDb) {
        await voidSaleLocal(powerSyncDb, {
          saleId,
          userId: tenantContext.user.id,
          tenantId: tenantContext.tenant.id,
        });
      } else {
        const sale = await voidSaleAction(saleId);
        upsertSale(sale);
      }
      showToast("Venta anulada", "info");
      return true;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "No se pudo anular la venta",
        "danger"
      );
      return false;
    }
  }

  async function handleRefundSale(saleId: string) {
    if (!tenantContext.tenant) {
      showToast("Tu cuenta aún no tiene un tenant.", "danger");
      return false;
    }
    try {
      if (powerSyncDb) {
        await refundSaleLocal(powerSyncDb, {
          saleId,
          userId: tenantContext.user.id,
          tenantId: tenantContext.tenant.id,
        });
      } else {
        const sale = await refundSaleAction(saleId);
        upsertSale(sale);
      }
      showToast("Reembolso registrado", "info");
      return true;
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "No se pudo registrar el reembolso",
        "danger"
      );
      return false;
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
        openProductEditor={() => openEditor(null)}
      />
    ),
    reports: (
      <ReportsScreen
        sales={sales}
        openSale={openSaleDetail}
        voidSale={(saleId) => {
          void handleVoidSale(saleId);
        }}
        refundSale={(saleId) => {
          void handleRefundSale(saleId);
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
          if (!tenantContext.tenant) {
            showToast("Tu cuenta aún no tiene un tenant.", "danger");
            return;
          }
          try {
            if (powerSyncDb) {
              await restoreProductLocal(powerSyncDb, {
                tenantId: tenantContext.tenant.id,
                productId,
              });
            } else {
              const product = await restoreProductAction(productId);
              upsertProduct(product);
            }
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
      />
    ),
    cart: (
      <CartScreen
        cartDetails={cartDetails}
        subtotal={cartSubtotal}
        decrementCart={decrementCart}
        addToCart={addToCart}
        removeFromCart={removeFromCart}
        setLineDiscount={setLineDiscount}
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
          if (!tenantContext.tenant) {
            showToast("Tu cuenta aún no tiene un tenant.", "danger");
            return;
          }
          try {
            if (powerSyncDb) {
              await archiveProductLocal(powerSyncDb, {
                tenantId: tenantContext.tenant.id,
                productId,
              });
            } else {
              const product = await archiveProductAction(productId);
              upsertProduct(product);
            }
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
          void handleVoidSale(saleId).then((voided) => {
            if (voided) {
              setView("reports");
            }
          });
        }}
        refundSale={(saleId) => {
          void handleRefundSale(saleId).then((refunded) => {
            if (refunded) {
              setView("reports");
            }
          });
        }}
      />
    ),
  }[view];

  return (
    <main className="app-shell">
      <div className="phone-frame">
        {content}
        <SyncStatusPill />
        {["sell", "reports", "products", "settings"].includes(view) ? (
          <BottomNav view={view} setView={(nextView) => setView(nextView)} />
        ) : null}
        {toast ? <Toast toast={toast} /> : null}
      </div>
    </main>
  );
}
