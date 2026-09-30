"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  archiveProduct as archiveProductAction,
  createProduct,
  restoreProduct as restoreProductAction,
  updateProduct as updateProductAction,
  uploadProductImage,
} from "@/app/products/actions";
import {
  createCategory as createCategoryAction,
  deleteCategory as deleteCategoryAction,
  renameCategory as renameCategoryAction,
} from "@/app/categories/actions";
import {
  createSale,
  refundSale as refundSaleAction,
  voidSale as voidSaleAction,
} from "@/app/sales/actions";
import { addInventoryMovement as addInventoryMovementAction } from "@/app/inventory/actions";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { toast as sonnerToast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { BottomNav } from "@/components/organisms/bottom-nav";
import { CartScreen } from "@/components/screens/cart-screen";
import { CategoriesScreen } from "@/components/screens/categories-screen";
import { PaymentScreen } from "@/components/screens/payment-screen";
import {
  ProductEditor,
  type ProductEditorSaveInput,
} from "@/components/screens/product-editor";
import { ProductsScreen } from "@/components/screens/products-screen";
import { ReportsScreen } from "@/components/screens/reports-screen";
import { SaleDetailScreen } from "@/components/screens/sale-detail-screen";
import { SalesScreen } from "@/components/screens/sales-screen";
import { SellScreen } from "@/components/screens/sell-screen";
import { MoreScreen } from "@/components/screens/more-screen";
import { SettingsScreen } from "@/components/screens/settings-screen";
import { DiagnosticsScreen } from "@/components/screens/diagnostics-screen";
import { unwrapActionResult } from "@/lib/action-result";
import { ALL_CATEGORIES, sortCategories } from "@/lib/categories";
import { paymentLabels, saleTotal, sortSalesNewestFirst } from "@/lib/sales";
import { cartSubtotalCents } from "@/lib/sales/pricing";
import {
  mapLocalProductRow,
  type LocalProductRow,
} from "@/lib/powersync/products-from-local";
import {
  mapLocalInventoryMovementRow,
  type LocalInventoryMovementRow,
} from "@/lib/powersync/inventory-from-local";
import {
  buildSalesFromLocal,
  type LocalRefundRow,
  type LocalSaleLineRow,
  type LocalSaleRow,
} from "@/lib/powersync/sales-from-local";
import {
  buildUserNameMap,
  isTeamReplicationConfirmed,
  mapTenantUserRow,
  mergeTenantMembersFromWatch,
  type LocalTenantUserRow,
} from "@/lib/powersync/tenant-users-from-local";
import {
  createProductEditorSessions,
  editorPendingWrite,
  type ProductWrite,
} from "@/lib/product-editor-sessions";
import { createScrollMemory } from "@/lib/scroll-memory";
import { usePosStore } from "@/lib/store";
import { useSalesRangeState } from "@/lib/use-sales-range";
import type {
  Category,
  CartLine,
  PaymentMethod,
  Product,
  Sale,
  TenantInvitation,
  TenantMember,
} from "@/lib/types";
import type { View } from "@/lib/views";
import type { UserTenantContext } from "@/lib/auth/tenant-context";
import { useOptionalPowerSyncDb } from "@/components/providers/powersync-provider";
import { isPowerSyncConfigured } from "@/lib/env";
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
import { powerSyncDraftCartStorage } from "@/lib/powersync/draft-cart";
import { browserDraftCartStorage } from "@/lib/browser-draft-cart";
import type { DraftCartStorage } from "@/lib/draft-cart";
import { onLocalDataEvent } from "@/lib/powersync/local-data-teardown";
import { keepAppShellForOfflineLaunch } from "@/lib/pwa/keep-app-shell";
import {
  mergeLocalRowsOverServer,
  watchLocalTables,
  watchTenantRows,
} from "@/lib/powersync/local-watch";
import type { TenantWork } from "@/lib/powersync/tenant-work";
import { useTenantWork } from "@/lib/powersync/use-tenant-work";
import {
  createCategoryLocal,
  deleteCategoryLocal,
  renameCategoryLocal,
} from "@/lib/powersync/write-categories";
import {
  mapLocalCategoryRow,
  type LocalCategoryRow,
} from "@/lib/powersync/categories-from-local";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  compareMovementsOldestFirst,
  computeStockByProduct,
  lookUpInitialMovement,
  resolveInitialStockDelta,
  type InitialMovementState,
  type InventoryMovement,
  type InventoryMovementReason,
  type InventorySnapshot,
  type OpeningStock,
} from "@/lib/inventory";
import {
  addInventoryMovement,
  initialMovementStateLocal,
} from "@/lib/powersync/write-inventory";
import { formatBs } from "@/lib/money";
import { randomUuid } from "@/lib/uuid";
import {
  reportClientFailure,
  type ClientFailureComponent,
} from "@/lib/observability/report-client-failure";

/** Logs and reports a failed local watch, which would otherwise go quiet. */
function watchFailed(message: string, component: ClientFailureComponent) {
  return (error: unknown) => {
    console.error(`[PowerSync] ${message}`, error);
    reportClientFailure(component, error);
  };
}

type ToastTone = "success" | "info" | "danger";

const NO_TENANT_MESSAGE = "Tu puesto aún no está configurado.";

/** What a write for the active tenant gets (see runTenantWrite). */
type TenantWriteInput = {
  tenant: NonNullable<UserTenantContext["tenant"]>;
  work: ReturnType<TenantWork["begin"]>;
};

/** A write for the active tenant, with and without PowerSync. */
type TenantWrite<T> = {
  local: (
    input: TenantWriteInput & { db: AbstractPowerSyncDatabase }
  ) => Promise<T>;
  server: (input: TenantWriteInput) => Promise<T>;
  /** Set while the write runs; not cleared once its work was cancelled. */
  pending?: (pending: boolean) => void;
};

const noLocalLedgerLoaded = { movements: false, sales: false };

type GlitterPosAppProps = {
  tenantContext: UserTenantContext;
  initialCategories: Category[];
  initialProducts: Product[];
  initialSales: Sale[];
  initialTenantMembers: TenantMember[];
  /** Null without a tenant. */
  initialInventory: InventorySnapshot | null;
  activeInvitation: TenantInvitation | null;
  inviteOrigin: string;
};

export function GlitterPosApp({
  tenantContext,
  initialCategories,
  initialProducts,
  initialSales,
  initialTenantMembers,
  initialInventory,
  activeInvitation,
  inviteOrigin,
}: GlitterPosAppProps) {
  const products = usePosStore((state) => state.products);
  const cart = usePosStore((state) => state.cart);
  const sales = usePosStore((state) => state.sales);
  const addToCart = usePosStore((state) => state.addToCart);
  const decrementCart = usePosStore((state) => state.decrementCart);
  const removeFromCart = usePosStore((state) => state.removeFromCart);
  const setLineDiscount = usePosStore((state) => state.setLineDiscount);
  const clearCart = usePosStore((state) => state.clearCart);
  const restoreCart = usePosStore((state) => state.restoreCart);
  const cartRevision = usePosStore((state) => state.cartRevision);
  const hydrateCart = usePosStore((state) => state.hydrateCart);
  const recordSale = usePosStore((state) => state.recordSale);
  const upsertSale = usePosStore((state) => state.upsertSale);
  const hydrateProducts = usePosStore((state) => state.hydrateProducts);
  const hydrateSales = usePosStore((state) => state.hydrateSales);
  const upsertProduct = usePosStore((state) => state.upsertProduct);
  const renameProductCategory = usePosStore(
    (state) => state.renameProductCategory
  );

  const [view, setView] = useState<View>("sell");
  const [categories, setCategories] = useState(() =>
    sortCategories(initialCategories)
  );
  const [activeInvitationState, setActiveInvitationState] =
    useState(activeInvitation);
  const [previousView, setPreviousView] = useState<View>("products");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [catalogCategory, setCatalogCategory] = useState(ALL_CATEGORIES);
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  // Where Payment's back button returns: the screen that opened it.
  const [paymentReturnView, setPaymentReturnView] = useState<"sell" | "cart">(
    "sell"
  );
  // Kept here rather than in the screens, which unmount on every view
  // change: the range Sales and Reports share, the Sales list's page, and
  // its scroll position while a sale's detail is open.
  const salesRange = useSalesRangeState();
  const [salesScrollMemory] = useState(createScrollMemory);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  // The product save, archive or restore in progress. One runs at a time: a
  // second tap while a slow photo upload or server round-trip is still
  // running would repeat it, and a repeated create adds a duplicate product.
  const [productWrite, setProductWrite] = useState<ProductWrite | null>(null);
  const productWriteRef = useRef<ProductWrite | null>(null);
  // Each opening of the product editor is a session. A save that finishes
  // after its editor closed does not leave the editor opened since, and a
  // product a save created is updated by a retry in that session only, never
  // by a save in a later one.
  const [editorSessions] = useState(() =>
    createProductEditorSessions<Pick<Product, "id" | "tracksInventory">>()
  );
  // The open session's number, for rendering: set with each editorSessions
  // change.
  const [editorSession, setEditorSession] = useState(editorSessions.current);
  // The server-action checkout's sale id, kept while the same checkout is
  // retried (see handlePayment).
  const checkoutAttemptRef = useRef<{ key: string; saleId: string } | null>(
    null
  );
  const [tenantMembers, setTenantMembers] =
    useState<TenantMember[]>(initialTenantMembers);
  const [inventoryMovements, setInventoryMovements] = useState<
    InventoryMovement[]
  >(() => initialInventory?.movements ?? []);
  const [openingStock, setOpeningStock] = useState<OpeningStock | null>(
    () => initialInventory?.opening ?? null
  );
  // Which of the movements and sales hold the device's whole ledger: with
  // PowerSync, once their watch reads the local store after the first sync.
  // Until both do, stock counts from the server's opening (see stockOpening).
  const [localLedgerLoaded, setLocalLedgerLoaded] =
    useState(noLocalLedgerLoaded);
  // Whether the product in the editor already has its initial count (see
  // lookUpInitialMovement), for the product it was looked up for.
  const [editorInitialMovement, setEditorInitialMovement] = useState<{
    productId: string;
    state: InitialMovementState;
  } | null>(null);
  // Whether stock counts can be shown. With PowerSync, once the server sent
  // movements or the inventory watch read the synced local store.
  const [inventoryStockReady, setInventoryStockReady] = useState(
    () => !isPowerSyncConfigured() || (initialInventory?.hasMovements ?? false)
  );
  const [teamSyncConfirmed, setTeamSyncConfirmed] = useState(
    () => initialTenantMembers.length === 0
  );
  const initialTenantMembersRef = useRef(initialTenantMembers);
  // The server-rendered data the local rows are merged over until the first
  // sync completes (see the watches below).
  const initialCategoriesRef = useRef(initialCategories);
  const initialProductsRef = useRef(initialProducts);
  const initialSalesRef = useRef(initialSales);
  const initialInventoryRef = useRef(initialInventory);
  const teamSyncEverConfirmedRef = useRef(false);
  const [tenantWorkGeneration, tenantWork] = useTenantWork({
    userId: tenantContext.user.id,
    tenantId: tenantContext.tenant?.id ?? null,
  });
  // The "Carrito vaciado" toast whose Deshacer can still bring the lines back.
  const clearedCartToastRef = useRef<{
    toastId: string | number;
    cartRevision: number;
  } | null>(null);
  const draftCartReadyRef = useRef(false);
  const cartRef = useRef(cart);
  const cartUpdatedAtRef = useRef<string | null>(null);

  const activeProducts = products.filter((product) => !product.archivedAt);
  // The rails' categories: the tenant's, then any a product still names that
  // is not one of them (such as one another device just renamed).
  const categoryNames = useMemo(() => {
    const names = categories.map((item) => item.name);
    for (const product of products) {
      if (!names.includes(product.category)) names.push(product.category);
    }
    return names;
  }, [categories, products]);
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
  const cartSubtotal = cartSubtotalCents(cartDetails);
  const cartCount = cartDetails.reduce(
    (total, line) => total + line.quantity,
    0
  );
  const selectedSale = selectedSaleId
    ? (sales.find((sale) => sale.id === selectedSaleId) ?? null)
    : null;

  // Fall back to server-hydrated members while tenant_users is still
  // replicating — avoids "Vendedor" regressions in reports on upgrade.
  const membersForNames = useMemo(
    () => (tenantMembers.length > 0 ? tenantMembers : initialTenantMembers),
    [tenantMembers, initialTenantMembers]
  );
  const userNameById = useMemo(
    () => buildUserNameMap(membersForNames),
    [membersForNames]
  );
  // '/' sends the ledger up to a recent cutoff summed per product (the
  // opening), and the movements and sales after it as rows. Without
  // PowerSync that stays so. With it, the local store holds every row once
  // the first sync completes, and stock counts from those alone, so rows
  // that reach the server late with an old date (a device offline for
  // weeks) count as well.
  const stockOpening =
    localLedgerLoaded.movements && localLedgerLoaded.sales
      ? null
      : openingStock;
  const stockByProduct = useMemo(
    () => computeStockByProduct(inventoryMovements, sales, stockOpening),
    [inventoryMovements, sales, stockOpening]
  );
  const activeTenantId = tenantContext.tenant?.id ?? null;

  // This only mounts once the local data is ready for the signed-in identity
  // (PowerSyncProvider), after any teardown that deleted the previous
  // session's saved app shell. Saving this one lets the next launch open
  // Sell Mode offline, even with no online launch after a sign-in or a
  // tenant change.
  useEffect(() => keepAppShellForOfflineLaunch(), []);

  // Teardown is initiated from Settings, outside this component's local React
  // state. Clear every tenant-derived value immediately so a failed navigation
  // or a recovery screen cannot expose data from the previous account.
  useEffect(() => {
    const stopTenantWork = onLocalDataEvent("teardown-starting", () => {
      tenantWork.cancel();
      setIsCheckingOut(false);
    });
    const resumeTenantWork = onLocalDataEvent("teardown-failed", () => {
      tenantWork.resumeAfterFailedTeardown();
    });
    const clearTenantState = onLocalDataEvent("cleared", () => {
      tenantWork.cancel();
      draftCartReadyRef.current = false;
      setView("sell");
      setPreviousView("products");
      setCategory(ALL_CATEGORIES);
      setCatalogCategory(ALL_CATEGORIES);
      setQuery("");
      setCatalogQuery("");
      setEditingProduct(null);
      setEditorSession(editorSessions.next());
      setSelectedSaleId(null);
      setIsCheckingOut(false);
      setActiveInvitationState(null);
      setCategories([]);
      setTenantMembers([]);
      setInventoryMovements([]);
      setOpeningStock(null);
      setLocalLedgerLoaded(noLocalLedgerLoaded);
      setInventoryStockReady(false);
      setTeamSyncConfirmed(false);
      setEditorInitialMovement(null);
    });

    return () => {
      stopTenantWork();
      resumeTenantWork();
      clearTenantState();
    };
  }, [editorSessions, tenantWork]);

  useEffect(() => {
    initialTenantMembersRef.current = initialTenantMembers;
    teamSyncEverConfirmedRef.current = false;
    setTeamSyncConfirmed(initialTenantMembers.length === 0);
  }, [initialTenantMembers]);

  // The store starts empty, and a passive effect runs after the browser has
  // painted: the first frame would show the empty catalog's first-product
  // prompt to a vendor with a full catalog. A layout effect installs the
  // server rows before that paint.
  useLayoutEffect(() => {
    initialCategoriesRef.current = initialCategories;
    initialProductsRef.current = initialProducts;
    initialSalesRef.current = initialSales;
    initialInventoryRef.current = initialInventory;
    hydrateProducts(initialProducts);
    hydrateSales(initialSales);
  }, [
    hydrateProducts,
    hydrateSales,
    initialCategories,
    initialProducts,
    initialSales,
    initialInventory,
  ]);

  useEffect(() => {
    setTenantMembers(initialTenantMembers);
    // The first render already has them (the state's initial value).
    setCategories(sortCategories(initialCategories));
    setInventoryMovements(initialInventory?.movements ?? []);
    setOpeningStock(initialInventory?.opening ?? null);
    setLocalLedgerLoaded(noLocalLedgerLoaded);
    if (!isPowerSyncConfigured()) {
      setInventoryStockReady(Boolean(activeTenantId));
    } else {
      setInventoryStockReady(initialInventory?.hasMovements ?? false);
    }

    // PowerSyncProvider only renders this tree once this exact identity's
    // local store is ready. Resume after its server-hydrated data is installed.
    tenantWork.resumeForReadyIdentity({
      userId: tenantContext.user.id,
      tenantId: activeTenantId,
    });
    // New server data (the products and sales installed above) puts the
    // ledger back to it as well.
  }, [
    initialCategories,
    initialProducts,
    initialSales,
    initialTenantMembers,
    initialInventory,
    activeTenantId,
    tenantContext.user.id,
    tenantWork,
  ]);

  useEffect(() => {
    cartRef.current = cart;
    cartUpdatedAtRef.current = usePosStore.getState().cartUpdatedAt;
  }, [cart]);

  // Once the cart changes after it was emptied (a product added, the undo
  // itself, a sale or a teardown), Deshacer no longer applies.
  useEffect(() => {
    const clearedCartToast = clearedCartToastRef.current;
    if (clearedCartToast && clearedCartToast.cartRevision !== cartRevision) {
      sonnerToast.dismiss(clearedCartToast.toastId);
      clearedCartToastRef.current = null;
    }
  }, [cartRevision]);

  // Subscribe to the local PowerSync SQLite store and push updates into
  // Zustand. Server-prop hydration above gives the first paint. Until the
  // first sync completes, the local store holds only this device's own
  // writes, so they are merged over the server data (an empty store must not
  // wipe it); from then on the local rows replace it and keep the UI live as
  // new rows replicate down. See lib/powersync/local-watch.ts.
  //
  // Tenant filter: sync rules already scope replication by tenant_id and
  // sign-out wipes the local store via disconnectAndClear, but we also
  // filter the read in case a race or a future code path leaves stale
  // rows on disk under a different tenant_id.
  const powerSyncDb = useOptionalPowerSyncDb();

  // Whether a product already has its initial count, from the ledger in
  // memory and, with PowerSync, the local store (see lookUpInitialMovement).
  const initialMovementOf = useCallback(
    (productId: string, db: AbstractPowerSyncDatabase | null) =>
      lookUpInitialMovement({
        productId,
        movements: inventoryMovements,
        opening: stockOpening,
        readLocal: db ? (id) => initialMovementStateLocal(db, id) : null,
        ledgerReady: inventoryStockReady,
      }),
    [inventoryMovements, stockOpening, inventoryStockReady]
  );

  // The same for the product in the editor. Only looked up while the editor
  // is open: editingProduct stays set after it closes, and every stock change
  // would otherwise query SQLite again.
  const editorOpen = view === "editor";
  const editingProductId = editingProduct?.id ?? null;
  useEffect(() => {
    if (!editorOpen || !editingProductId) return;
    const isCurrentGeneration = tenantWork.captureGeneration();
    let cancelled = false;
    const isCurrent = () => !cancelled && isCurrentGeneration();
    const productId = editingProductId;

    initialMovementOf(productId, powerSyncDb).then(
      (state) => {
        if (isCurrent()) {
          setEditorInitialMovement({ productId, state });
        }
      },
      (error: unknown) => {
        if (isCurrent()) {
          console.error("[PowerSync] initial movement lookup failed", error);
          reportClientFailure("powersync_initial_movement_lookup", error);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [
    editorOpen,
    editingProductId,
    powerSyncDb,
    initialMovementOf,
    tenantWork,
  ]);
  // A new product has no count yet. One not looked up yet (or whose lookup
  // failed) is unknown until it is.
  const editorInitialMovementState: InitialMovementState = !editingProductId
    ? "none"
    : editorInitialMovement?.productId === editingProductId
      ? editorInitialMovement.state
      : "unknown";

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;
    return watchTenantRows<LocalProductRow>(powerSyncDb, {
      sql: "SELECT * FROM products WHERE tenant_id = ? ORDER BY created_at DESC",
      tenantId: activeTenantId,
      isCurrent: tenantWork.captureGeneration(),
      onRows: (rows, synced) => {
        const localProducts = rows.map(mapLocalProductRow);
        hydrateProducts(
          synced
            ? localProducts
            : mergeLocalRowsOverServer(
                initialProductsRef.current,
                localProducts
              )
        );
      },
      onError: watchFailed("products watch error", "powersync_products_watch"),
    });
    // The server rows are read through refs, but they are dependencies all
    // the same: when '/' renders again (a server action that set a cookie
    // re-renders it), the effect above puts the server rows back, and
    // subscribing again reads the local rows over them.
  }, [
    powerSyncDb,
    hydrateProducts,
    activeTenantId,
    tenantWork,
    tenantWorkGeneration,
    initialProducts,
  ]);

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;
    return watchTenantRows<LocalCategoryRow>(powerSyncDb, {
      sql: "SELECT * FROM categories WHERE tenant_id = ? ORDER BY name ASC",
      tenantId: activeTenantId,
      isCurrent: tenantWork.captureGeneration(),
      onRows: (rows, synced) => {
        const localCategories = rows.map(mapLocalCategoryRow);
        setCategories(
          sortCategories(
            synced
              ? localCategories
              : mergeLocalRowsOverServer(
                  initialCategoriesRef.current,
                  localCategories
                )
          )
        );
      },
      onError: watchFailed(
        "categories watch error",
        "powersync_categories_watch"
      ),
    });
    // initialCategories: see the products watch.
  }, [
    powerSyncDb,
    activeTenantId,
    tenantWork,
    tenantWorkGeneration,
    initialCategories,
  ]);

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;
    return watchTenantRows<LocalInventoryMovementRow>(powerSyncDb, {
      sql: "SELECT * FROM inventory_movements WHERE tenant_id = ? ORDER BY created_at ASC, id ASC",
      tenantId: activeTenantId,
      isCurrent: tenantWork.captureGeneration(),
      onRows: (rows, synced) => {
        const localMovements = rows.map(mapLocalInventoryMovementRow);
        if (synced) {
          setInventoryMovements(localMovements);
          setLocalLedgerLoaded((loaded) =>
            loaded.movements ? loaded : { ...loaded, movements: true }
          );
          setInventoryStockReady(true);
        } else {
          // Stock readiness still follows the server data until then.
          setInventoryMovements(
            mergeLocalRowsOverServer(
              initialInventoryRef.current?.movements ?? [],
              localMovements
            ).sort(compareMovementsOldestFirst)
          );
        }
      },
      onError: watchFailed(
        "inventory_movements watch error",
        "powersync_inventory_watch"
      ),
    });
    // initialInventory: see the products watch.
  }, [
    powerSyncDb,
    activeTenantId,
    tenantWork,
    tenantWorkGeneration,
    initialInventory,
  ]);

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;
    const db = powerSyncDb;
    setTeamSyncConfirmed(initialTenantMembersRef.current.length === 0);
    teamSyncEverConfirmedRef.current = false;

    return watchTenantRows<LocalTenantUserRow>(db, {
      sql: "SELECT * FROM tenant_users WHERE tenant_id = ? ORDER BY created_at ASC, id ASC",
      tenantId: activeTenantId,
      isCurrent: tenantWork.captureGeneration(),
      // Memberships are never written on the device: before the first sync
      // there is nothing local to show, and the server members stay.
      syncedOnly: true,
      onRows: (rows) => {
        const mapped = rows.map(mapTenantUserRow);
        const serverMembers = initialTenantMembersRef.current;
        const hasSynced = db.currentStatus?.hasSynced ?? false;
        const confirmed = isTeamReplicationConfirmed(
          mapped,
          serverMembers,
          hasSynced
        );
        if (confirmed) {
          teamSyncEverConfirmedRef.current = true;
        }
        setTeamSyncConfirmed(confirmed);
        setTenantMembers((prev) =>
          mergeTenantMembersFromWatch(prev, mapped, {
            allowMemberShrink: teamSyncEverConfirmedRef.current,
            replicationConfirmed: confirmed,
          })
        );
      },
      onError: watchFailed(
        "tenant_users watch error",
        "powersync_tenant_users_watch"
      ),
    });
  }, [powerSyncDb, activeTenantId, tenantWork, tenantWorkGeneration]);

  // Subscribe to sales + sale_lines + refunds. PowerSync's onChange fires
  // whenever any of the three tables mutates; we requery all three and
  // rebuild the in-memory Sale[] (same shape as the server-side
  // getSalesForTenant returns). User display names come from synced
  // tenant_users rows (see the watch above).
  const currentUserId = tenantContext.user.id;
  const currentUserName = tenantContext.user.displayName;
  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;

    const db = powerSyncDb;
    const isCurrentGeneration = tenantWork.captureGeneration();
    const isCurrent = (signal: AbortSignal) =>
      !signal.aborted && isCurrentGeneration();

    function resolveUserName(userId: string) {
      return (
        userNameById.get(userId) ??
        (userId === currentUserId ? currentUserName : "Vendedor")
      );
    }

    async function rebuildSales(signal: AbortSignal, synced: boolean) {
      if (!isCurrent(signal)) return;
      try {
        // Tenant-scoped reads: see the note on the products watch above.
        const [saleRows, lineRows, refundRows] = await Promise.all([
          db.getAll<LocalSaleRow>(
            "SELECT * FROM sales WHERE tenant_id = ? ORDER BY created_at DESC",
            [activeTenantId]
          ),
          db.getAll<LocalSaleLineRow>(
            "SELECT * FROM sale_lines WHERE tenant_id = ?",
            [activeTenantId]
          ),
          db.getAll<LocalRefundRow>(
            "SELECT * FROM refunds WHERE tenant_id = ? ORDER BY created_at DESC",
            [activeTenantId]
          ),
        ]);
        if (!isCurrent(signal)) return;
        const localSales = buildSalesFromLocal(
          saleRows,
          lineRows,
          refundRows,
          resolveUserName
        );
        if (synced) {
          hydrateSales(localSales);
          setLocalLedgerLoaded((loaded) =>
            loaded.sales ? loaded : { ...loaded, sales: true }
          );
        } else {
          hydrateSales(
            sortSalesNewestFirst(
              mergeLocalRowsOverServer(initialSalesRef.current, localSales)
            )
          );
        }
      } catch (error) {
        if (isCurrent(signal)) {
          console.error("[PowerSync] sales rebuild failed", error);
          reportClientFailure("powersync_sales_rebuild", error);
        }
      }
    }

    return watchLocalTables(db, ({ signal, synced }) => {
      db.onChange(
        {
          onChange: () => rebuildSales(signal, synced),
          onError: watchFailed("sales onChange error", "powersync_sales_watch"),
        },
        {
          signal,
          tables: ["sales", "sale_lines", "refunds"],
          triggerImmediate: true,
        }
      );
    });
  }, [
    powerSyncDb,
    hydrateSales,
    currentUserId,
    currentUserName,
    activeTenantId,
    userNameById,
    tenantWork,
    tenantWorkGeneration,
    // See the products watch.
    initialSales,
  ]);

  // The draft cart survives a reload: in the local SQLite store with
  // PowerSync, in this browser's storage without it (lib/draft-cart.ts).
  const draftCartStorage = useMemo(
    () =>
      powerSyncDb
        ? powerSyncDraftCartStorage(powerSyncDb)
        : isPowerSyncConfigured()
          ? null
          : browserDraftCartStorage(),
    [powerSyncDb]
  );

  useEffect(() => {
    if (!draftCartStorage) return;

    const isCurrentGeneration = tenantWork.captureGeneration();
    let cancelled = false;
    const isCurrent = () => !cancelled && isCurrentGeneration();
    draftCartReadyRef.current = false;
    const expectedCartRevision = usePosStore.getState().cartRevision;

    async function hydrateDraftCart(storage: DraftCartStorage) {
      try {
        const draft = await storage.load();
        if (!isCurrent()) return;

        hydrateCart(draft.cart, draft.updatedAt, expectedCartRevision);
        draftCartReadyRef.current = true;
      } catch (error) {
        if (isCurrent()) {
          console.error("[draft cart] hydrate failed", error);
          reportClientFailure("powersync_draft_cart_hydrate", error);
          draftCartReadyRef.current = true;
        }
      }
    }

    void hydrateDraftCart(draftCartStorage);

    return () => {
      cancelled = true;
    };
  }, [draftCartStorage, hydrateCart, tenantWork, tenantWorkGeneration]);

  useEffect(() => {
    if (!draftCartStorage || !draftCartReadyRef.current) {
      return;
    }

    const isCurrentGeneration = tenantWork.captureGeneration();
    const timeout = window.setTimeout(() => {
      if (!isCurrentGeneration() || !draftCartReadyRef.current) {
        return;
      }
      void draftCartStorage.save(cart, usePosStore.getState().cartUpdatedAt);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [draftCartStorage, cart, tenantWork, tenantWorkGeneration]);

  useEffect(() => {
    const isCurrentGeneration = tenantWork.captureGeneration();
    function flushDraftCart() {
      if (
        !draftCartStorage ||
        !draftCartReadyRef.current ||
        !isCurrentGeneration()
      ) {
        return;
      }

      void draftCartStorage.save(cartRef.current, cartUpdatedAtRef.current);
    }

    function flushWhenHidden() {
      if (document.visibilityState === "hidden") {
        flushDraftCart();
      }
    }

    window.addEventListener("pagehide", flushDraftCart);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      window.removeEventListener("pagehide", flushDraftCart);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [draftCartStorage, tenantWork, tenantWorkGeneration]);

  function showToast(text: string, tone: ToastTone = "success") {
    if (tone === "danger") {
      sonnerToast.error(text);
    } else if (tone === "info") {
      sonnerToast.info(text);
    } else {
      sonnerToast.success(text);
    }
  }

  /**
   * Runs a write for the active tenant. The environment picks the path: with
   * PowerSync configured, the provider renders the app only once the local
   * store is ready, so `local` writes to it and the upload queue replicates
   * the rows to Supabase in the background. (db is null there only during a
   * local teardown, which has already cancelled tenant work, so `server` is
   * not called then.) Without PowerSync (local-only mode), `server` calls
   * the server actions.
   *
   * Resolves to the write's result, or to null once its tenant work was
   * cancelled (a teardown started), which callers ignore. Any other failure,
   * and a missing tenant, is thrown.
   */
  async function runTenantWrite<T>(
    write: TenantWrite<T>
  ): Promise<{ value: T } | null> {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      throw new Error(NO_TENANT_MESSAGE);
    }
    const work = tenantWork.begin();
    const db = powerSyncDb;
    try {
      work.assertCurrent();
      write.pending?.(true);
      const value = db
        ? await write.local({ tenant, work, db })
        : await write.server({ tenant, work });
      work.assertCurrent();
      return { value };
    } catch (error) {
      if (!work.isCurrent()) {
        return null;
      }
      throw error;
    } finally {
      if (work.isCurrent()) {
        write.pending?.(false);
      }
    }
  }

  /** runTenantWrite for a screen that shows a failure as a toast. */
  async function runTenantWriteWithToast<T>(
    failureMessage: string,
    write: TenantWrite<T>
  ): Promise<{ value: T } | null> {
    try {
      return await runTenantWrite(write);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : failureMessage,
        "danger"
      );
      return null;
    }
  }

  function openEditor(product: Product | null) {
    setPreviousView(view === "editor" ? "products" : view);
    setEditingProduct(product);
    setEditorSession(editorSessions.next());
    setView("editor");
  }

  function closeEditor(nextView: View) {
    setEditorSession(editorSessions.next());
    setView(nextView);
  }

  async function runProductWrite(
    write: ProductWrite,
    run: () => Promise<void>
  ) {
    if (productWriteRef.current) {
      // Its buttons wait for the write in progress, but say so if a tap
      // still gets here instead of dropping it silently.
      showToast("Esperá a que termine el cambio en curso", "info");
      return;
    }
    productWriteRef.current = write;
    setProductWrite(write);
    try {
      await run();
    } finally {
      productWriteRef.current = null;
      setProductWrite(null);
    }
  }

  function handleSaveProduct(input: ProductEditorSaveInput) {
    return runProductWrite(
      {
        kind: "save",
        productId: editingProduct?.id ?? null,
        editorSession: editorSessions.current(),
      },
      () => saveProduct(input)
    );
  }

  async function saveProduct({
    product: productInput,
    imageFile,
    initialStock,
  }: ProductEditorSaveInput) {
    const session = editorSessions.current();
    const existingProduct = editingProduct ?? editorSessions.createdIn(session);

    // The initial count to write with the product, if any
    // (resolveInitialStockDelta). A new product has none yet.
    async function initialStockDeltaToWrite(
      db: AbstractPowerSyncDatabase | null,
      work: TenantWriteInput["work"]
    ) {
      let initialMovement: InitialMovementState = "none";
      if (existingProduct) {
        initialMovement = await initialMovementOf(existingProduct.id, db);
        work.assertCurrent();
      }
      return resolveInitialStockDelta({
        tracksInventory: productInput.tracksInventory,
        wasTrackingInventory: existingProduct?.tracksInventory ?? false,
        initialMovement,
        initialStock,
      });
    }

    // Each path resolves to whether the photo upload failed: the product
    // itself is saved by then.
    const saved = await runTenantWriteWithToast(
      "No se pudo guardar el producto",
      {
        local: async ({ tenant, work, db }) => {
          const initialStockDelta = await initialStockDeltaToWrite(db, work);
          // The initial count is written in the product's own transaction.
          const initialStockMovement =
            initialStockDelta != null
              ? { userId: tenantContext.user.id, delta: initialStockDelta }
              : undefined;
          const productId = existingProduct
            ? (await updateProductLocal(db, {
                tenantId: tenant.id,
                productId: existingProduct.id,
                product: productInput,
                initialStock: initialStockMovement,
                assertCurrent: work.assertCurrent,
              }),
              existingProduct.id)
            : (
                await createProductLocal(db, {
                  tenantId: tenant.id,
                  product: productInput,
                  initialStock: initialStockMovement,
                  assertCurrent: work.assertCurrent,
                })
              ).productId;
          if (!editingProduct) {
            editorSessions.rememberCreated(session, {
              id: productId,
              tracksInventory: productInput.tracksInventory,
            });
          }

          if (!imageFile) {
            return false;
          }
          try {
            work.assertCurrent();
            await uploadProductImageLocal(createSupabaseBrowserClient(), db, {
              tenantId: tenant.id,
              productId,
              file: imageFile,
              assertCurrent: work.assertCurrent,
            });
            return false;
          } catch (error) {
            if (!work.isCurrent()) {
              throw error;
            }
            return true;
          }
        },
        server: async ({ tenant, work }) => {
          const initialStockDelta = await initialStockDeltaToWrite(null, work);
          let uploadFailed = false;
          // The initial count is written in the product's own transaction.
          const saved = await unwrapActionResult(
            () =>
              existingProduct
                ? updateProductAction(
                    tenant.id,
                    existingProduct.id,
                    productInput,
                    initialStockDelta
                  )
                : createProduct(tenant.id, productInput, initialStockDelta),
            "No se pudo guardar el producto"
          );
          work.assertCurrent();
          let product = saved.product;
          upsertProduct(product);
          if (saved.initialMovement) {
            addInventoryMovementToState(saved.initialMovement);
          }
          if (!editingProduct) {
            editorSessions.rememberCreated(session, product);
          }

          if (imageFile) {
            const productId = product.id;
            const formData = new FormData();
            formData.set("image", imageFile);
            try {
              work.assertCurrent();
              product = await unwrapActionResult(
                () => uploadProductImage(tenant.id, productId, formData),
                "No se pudo subir la imagen"
              );
              work.assertCurrent();
            } catch (error) {
              if (!work.isCurrent()) {
                throw error;
              }
              uploadFailed = true;
            }
          }
          work.assertCurrent();
          upsertProduct(product);
          return uploadFailed;
        },
      }
    );
    if (!saved) {
      return;
    }
    if (saved.value) {
      showToast("Producto guardado, pero no se pudo subir la imagen", "danger");
    } else {
      showToast(
        editingProduct ? "Producto actualizado" : "Producto agregado",
        editingProduct ? "info" : "success"
      );
    }
    // An editor opened while the save ran keeps what was typed in it.
    if (editorSessions.current() === session) {
      closeEditor("products");
    }
  }

  function handleArchiveProduct(productId: string) {
    return runProductWrite(
      {
        kind: "archive",
        productId,
        editorSession: editorSessions.current(),
      },
      () => archiveProduct(productId)
    );
  }

  async function archiveProduct(productId: string) {
    const session = editorSessions.current();
    const archived = await runTenantWriteWithToast(
      "No se pudo archivar el producto",
      {
        local: ({ tenant, work, db }) =>
          archiveProductLocal(db, {
            tenantId: tenant.id,
            productId,
            assertCurrent: work.assertCurrent,
          }),
        server: async ({ tenant, work }) => {
          const product = await unwrapActionResult(
            () => archiveProductAction(tenant.id, productId),
            "No se pudo archivar el producto"
          );
          work.assertCurrent();
          upsertProduct(product);
        },
      }
    );
    if (!archived) {
      return;
    }
    showToast("Producto archivado", "info");
    if (editorSessions.current() === session) {
      closeEditor("products");
    }
  }

  function handleRestoreProduct(productId: string) {
    return runProductWrite({ kind: "restore", productId }, () =>
      restoreProduct(productId)
    );
  }

  async function restoreProduct(productId: string) {
    const restored = await runTenantWriteWithToast(
      "No se pudo restaurar el producto",
      {
        local: ({ tenant, work, db }) =>
          restoreProductLocal(db, {
            tenantId: tenant.id,
            productId,
            assertCurrent: work.assertCurrent,
          }),
        server: async ({ tenant, work }) => {
          const product = await unwrapActionResult(
            () => restoreProductAction(tenant.id, productId),
            "No se pudo restaurar el producto"
          );
          work.assertCurrent();
          upsertProduct(product);
        },
      }
    );
    if (restored) {
      showToast("Producto restaurado", "info");
    }
  }

  // Category writes, from the category screen and the product editor. Their
  // drawers show a failure next to the name, so these throw it; they resolve
  // to null once the write was cancelled (see runTenantWrite). With PowerSync
  // the categories watch shows the change; without it the server action's
  // result is applied here.
  async function handleCreateCategory(name: string) {
    const created = await runTenantWrite({
      local: ({ tenant, work, db }) =>
        createCategoryLocal(db, {
          tenantId: tenant.id,
          name,
          assertCurrent: work.assertCurrent,
        }),
      server: async ({ tenant, work }) => {
        const category = await unwrapActionResult(
          () => createCategoryAction(tenant.id, name),
          "No se pudo crear la categoría"
        );
        work.assertCurrent();
        setCategories((current) =>
          sortCategories([
            category,
            ...current.filter((item) => item.id !== category.id),
          ])
        );
        return category;
      },
    });
    if (!created) {
      return null;
    }
    showToast("Categoría creada", "success");
    return created.value;
  }

  async function handleRenameCategory(categoryId: string, name: string) {
    const previousName = categories.find(
      (item) => item.id === categoryId
    )?.name;
    const renamed = await runTenantWrite({
      local: ({ tenant, work, db }) =>
        renameCategoryLocal(db, {
          tenantId: tenant.id,
          categoryId,
          name,
          assertCurrent: work.assertCurrent,
        }),
      server: async ({ tenant, work }) => {
        const category = await unwrapActionResult(
          () => renameCategoryAction(tenant.id, categoryId, name),
          "No se pudo renombrar la categoría"
        );
        work.assertCurrent();
        setCategories((current) =>
          sortCategories(
            current.map((item) => (item.id === categoryId ? category : item))
          )
        );
        // Postgres renamed it on the products too (the category triggers).
        if (previousName) {
          renameProductCategory(previousName, category.name);
        }
        return category;
      },
    });
    if (!renamed) {
      return null;
    }
    const newName = renamed.value.name;
    if (previousName) {
      // A rail filtered by the category keeps showing it.
      const follow = (current: string) =>
        current === previousName ? newName : current;
      setCategory(follow);
      setCatalogCategory(follow);
    }
    showToast("Categoría renombrada", "info");
    return renamed.value;
  }

  async function handleDeleteCategory(categoryId: string) {
    const deletedName = categories.find((item) => item.id === categoryId)?.name;
    const deleted = await runTenantWrite({
      local: ({ tenant, work, db }) =>
        deleteCategoryLocal(db, {
          tenantId: tenant.id,
          categoryId,
          assertCurrent: work.assertCurrent,
        }),
      server: async ({ tenant, work }) => {
        await unwrapActionResult(
          () => deleteCategoryAction(tenant.id, categoryId),
          "No se pudo eliminar la categoría"
        );
        work.assertCurrent();
        setCategories((current) =>
          current.filter((item) => item.id !== categoryId)
        );
      },
    });
    if (!deleted) {
      return;
    }
    if (deletedName) {
      const reset = (current: string) =>
        current === deletedName ? ALL_CATEGORIES : current;
      setCategory(reset);
      setCatalogCategory(reset);
    }
    showToast("Categoría eliminada", "info");
  }

  // Without PowerSync nothing watches inventory_movements, so a movement the
  // server action recorded is added here; stock is derived from this list.
  function addInventoryMovementToState(movement: InventoryMovement) {
    setInventoryMovements((current) =>
      [...current, movement].sort(compareMovementsOldestFirst)
    );
  }

  // Throws when the movement was not recorded: the editor shows the message
  // next to the stock fields and keeps what was typed.
  async function handleInventoryMovement(input: {
    productId: string;
    delta: number;
    reason: InventoryMovementReason;
    note?: string;
  }) {
    const recorded = await runTenantWrite({
      local: async ({ tenant, work, db }) => {
        await addInventoryMovement(db, {
          tenantId: tenant.id,
          userId: tenantContext.user.id,
          productId: input.productId,
          delta: input.delta,
          reason: input.reason,
          note: input.note,
          assertCurrent: work.assertCurrent,
        });
      },
      server: async ({ tenant, work }) => {
        const movement = await unwrapActionResult(
          () =>
            addInventoryMovementAction(tenant.id, {
              productId: input.productId,
              delta: input.delta,
              reason: input.reason,
              note: input.note,
            }),
          "No se pudo actualizar el inventario"
        );
        work.assertCurrent();
        addInventoryMovementToState(movement);
      },
    });
    if (recorded) {
      showToast("Inventario actualizado", "success");
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

    // Each path resolves to the sale's total, for the toast.
    const recorded = await runTenantWriteWithToast(
      "No se pudo registrar la venta",
      {
        pending: setIsCheckingOut,
        local: async ({ tenant, work, db }) => {
          const { totalCents } = await createSaleLocal(db, {
            tenantId: tenant.id,
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
            assertCurrent: work.assertCurrent,
          });
          work.assertCurrent();
          clearCart();
          void draftCartStorage?.clear();
          return formatBs(totalCents, true);
        },
        server: async ({ tenant, work }) => {
          const lines = cartDetails.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            lineDiscountCents: line.lineDiscountCents,
            lineDiscountReason: line.lineDiscountReason,
          }));
          // A retry of the same checkout (the response was lost, or the
          // network failed after the server recorded it) reuses the sale id,
          // so the server returns the recorded sale instead of a duplicate.
          // Any change to the checkout starts a new attempt.
          const checkoutKey = JSON.stringify([
            tenant.id,
            method,
            discount,
            reason ?? "",
            lines,
          ]);
          if (checkoutAttemptRef.current?.key !== checkoutKey) {
            checkoutAttemptRef.current = {
              key: checkoutKey,
              saleId: randomUuid(),
            };
          }
          const { saleId } = checkoutAttemptRef.current;
          const sale = await unwrapActionResult(
            () =>
              createSale(tenant.id, {
                saleId,
                paymentMethod: method,
                saleDiscountCents: discount,
                saleDiscountReason: reason,
                lines,
              }),
            "No se pudo registrar la venta"
          );
          checkoutAttemptRef.current = null;
          work.assertCurrent();
          recordSale(sale);
          void draftCartStorage?.clear();
          return saleTotal(sale);
        },
      }
    );
    if (!recorded) {
      return;
    }
    showToast(
      `Venta registrada · ${recorded.value} · ${paymentLabels[method]}`
    );
    setView("sell");
  }

  // Void and refund are confirmed in SaleActionDialog: a refusal is thrown,
  // so the dialog shows its reason, and false means the work was cancelled.
  async function handleVoidSale(saleId: string) {
    const voided = await runTenantWrite({
      local: ({ tenant, work, db }) =>
        voidSaleLocal(db, {
          saleId,
          userId: tenantContext.user.id,
          tenantId: tenant.id,
          assertCurrent: work.assertCurrent,
        }),
      server: async ({ tenant, work }) => {
        const sale = await unwrapActionResult(
          () => voidSaleAction(tenant.id, saleId),
          "No se pudo anular la venta"
        );
        work.assertCurrent();
        upsertSale(sale);
      },
    });
    if (!voided) {
      return false;
    }
    showToast("Venta anulada", "info");
    return true;
  }

  async function handleRefundSale(saleId: string, reason?: string) {
    const refunded = await runTenantWrite({
      local: ({ tenant, work, db }) =>
        refundSaleLocal(db, {
          saleId,
          userId: tenantContext.user.id,
          tenantId: tenant.id,
          reason,
          assertCurrent: work.assertCurrent,
        }),
      server: async ({ tenant, work }) => {
        const sale = await unwrapActionResult(
          () => refundSaleAction(tenant.id, saleId, reason),
          "No se pudo registrar el reembolso"
        );
        work.assertCurrent();
        upsertSale(sale);
      },
    });
    if (!refunded) {
      return false;
    }
    showToast("Reembolso registrado", "info");
    return true;
  }

  function handleClearCart() {
    const clearedLines = usePosStore.getState().cart;
    if (!clearedLines.length) {
      return;
    }
    clearCart();
    void draftCartStorage?.clear();
    const clearedRevision = usePosStore.getState().cartRevision;
    const toastId = sonnerToast.info("Carrito vaciado", {
      duration: 6000,
      action: {
        label: "Deshacer",
        onClick: () => restoreCart(clearedLines, clearedRevision),
      },
    });
    clearedCartToastRef.current = { toastId, cartRevision: clearedRevision };
    setView("sell");
  }

  function openSaleDetail(saleId: string) {
    setSelectedSaleId(saleId);
    setView("saleDetail");
  }

  function openPayment(from: "sell" | "cart") {
    setPaymentReturnView(from);
    setView("payment");
  }

  const content = {
    sell: (
      <SellScreen
        products={activeProducts}
        categories={categoryNames}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
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
        openPayment={() => openPayment("sell")}
        openProductEditor={() => openEditor(null)}
      />
    ),
    reports: (
      <ReportsScreen
        sales={sales}
        rangeState={salesRange}
        products={activeProducts}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        openSales={() => setView("sales")}
      />
    ),
    sales: (
      <SalesScreen
        sales={sales}
        rangeState={salesRange}
        scrollMemory={salesScrollMemory}
        openSale={openSaleDetail}
        voidSale={handleVoidSale}
        refundSale={handleRefundSale}
      />
    ),
    products: (
      <ProductsScreen
        products={products}
        categories={categoryNames}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        category={catalogCategory}
        query={catalogQuery}
        userDisplayName={tenantContext.user.displayName}
        userEmail={tenantContext.user.email}
        setCategory={setCatalogCategory}
        setQuery={setCatalogQuery}
        openEditor={openEditor}
        openCategories={() => setView("categories")}
        productWritePending={productWrite != null}
        restoringProductId={
          productWrite?.kind === "restore" ? productWrite.productId : null
        }
        restoreProduct={handleRestoreProduct}
      />
    ),
    categories: (
      <CategoriesScreen
        categories={categories}
        products={products}
        back={() => setView("products")}
        createCategory={handleCreateCategory}
        renameCategory={handleRenameCategory}
        deleteCategory={handleDeleteCategory}
      />
    ),
    more: (
      <MoreScreen
        tenantContext={tenantContext}
        openReports={() => setView("reports")}
        openSettings={() => setView("settings")}
      />
    ),
    settings: (
      <SettingsScreen
        tenantContext={tenantContext}
        tenantMembers={membersForNames}
        teamSyncPending={!teamSyncConfirmed && initialTenantMembers.length > 0}
        activeInvitation={activeInvitationState}
        inviteOrigin={inviteOrigin}
        onInvitationChange={setActiveInvitationState}
        productCount={activeProducts.length}
        // Every original sale that was not voided, refunded or not: refund
        // records carry status "refunded" and voided sales "voided".
        saleCount={sales.filter((sale) => sale.status === "completed").length}
        openDiagnostics={() => setView("diagnostics")}
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
        clearCart={handleClearCart}
        back={() => setView("sell")}
        charge={() => openPayment("cart")}
      />
    ),
    payment: (
      <PaymentScreen
        subtotal={cartSubtotal}
        count={cartCount}
        back={() => setView(paymentReturnView)}
        pay={handlePayment}
        isSubmitting={isCheckingOut}
      />
    ),
    editor: (
      <ProductEditor
        product={editingProduct}
        categories={categories}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        initialMovement={editorInitialMovementState}
        onInventoryMovement={handleInventoryMovement}
        back={() =>
          closeEditor(previousView === "sell" ? "products" : previousView)
        }
        pendingWrite={editorPendingWrite(productWrite, editorSession)}
        createCategory={handleCreateCategory}
        save={handleSaveProduct}
        archive={handleArchiveProduct}
      />
    ),
    saleDetail: (
      <SaleDetailScreen
        sale={selectedSale}
        sales={sales}
        back={() => setView("sales")}
        voidSale={handleVoidSale}
        refundSale={handleRefundSale}
      />
    ),
    diagnostics: (
      <DiagnosticsScreen
        tenantContext={tenantContext}
        back={() => setView("settings")}
      />
    ),
  }[view];

  return (
    <main className="app-shell">
      <div className="phone-frame">
        {content}
        <SyncStatusPill />
        {["sell", "sales", "reports", "products", "more", "settings"].includes(
          view
        ) ? (
          <BottomNav view={view} setView={(nextView) => setView(nextView)} />
        ) : null}
        <Toaster
          richColors
          position="bottom-center"
          offset={{ bottom: "88px" }}
          mobileOffset={{ bottom: "88px" }}
          duration={2600}
        />
      </div>
    </main>
  );
}
