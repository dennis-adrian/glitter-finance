"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import { createInventoryMovement as createInventoryMovementAction } from "@/app/inventory/actions";
import {
  createSale,
  refundSale as refundSaleAction,
  voidSale as voidSaleAction,
} from "@/app/sales/actions";
import { flushSync } from "react-dom";
import { toast as sonnerToast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { BottomNav } from "@/components/organisms/bottom-nav";
import { SideNav } from "@/components/organisms/side-nav";
import { CategoriesScreen } from "@/components/screens/categories-screen";
import {
  CheckoutScreen,
  type CheckoutPayment,
} from "@/components/screens/checkout-screen";
import { SaleCompleteScreen } from "@/components/screens/sale-complete-screen";
import { ProductEditor } from "@/components/screens/product-editor";
import { ProductsScreen } from "@/components/screens/products-screen";
import { ReportsScreen } from "@/components/screens/reports-screen";
import { SalesScreen } from "@/components/screens/sales-screen";
import { SellScreen } from "@/components/screens/sell-screen";
import { MoreScreen } from "@/components/screens/more-screen";
import { SettingsScreen } from "@/components/screens/settings-screen";
import { DiagnosticsScreen } from "@/components/screens/diagnostics-screen";
import { MissingRecordScreen } from "@/components/screens/missing-record-screen";
import { clampDiscount } from "@/lib/money";
import { mapDbProductToProduct } from "@/lib/product-mapper";
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
import { usePosStore } from "@/lib/store";
import type {
  Category,
  CartLine,
  Product,
  Sale,
  TenantInvitation,
  TenantMember,
  ToastMessage,
} from "@/lib/types";
import {
  isPrimaryView,
  primaryViewFor,
  type PrimaryView,
  type View,
} from "@/lib/views";
import { useAppRoute } from "@/lib/hooks/use-app-route";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/hooks/use-media-query";
import { useVirtualKeyboard } from "@/lib/hooks/use-virtual-keyboard";
import type { UserTenantContext } from "@/lib/auth/user-context";
import { useOptionalPowerSyncDb } from "@/components/providers/powersync-provider";
import { isPowerSyncConfigured } from "@/lib/env";
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
import {
  createCategoryLocal,
  deleteCategoryLocal,
  renameCategoryLocal,
} from "@/lib/powersync/write-categories";
import {
  clearDraftCartLocal,
  loadDraftCartLocal,
  migrateLegacyDraftCartLocal,
  saveDraftCartLocal,
} from "@/lib/powersync/draft-cart";
import {
  onLocalDataCleared,
  onLocalDataTeardownFailed,
  onLocalDataTeardownStarting,
} from "@/lib/powersync/local-data-teardown";
import { TenantWorkController } from "@/lib/powersync/tenant-work";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  computeStockByProduct,
  productHasInitialMovement,
  type InventoryMovement,
  type InventoryMovementReason,
} from "@/lib/inventory";
import {
  addInventoryMovement,
  productHasInitialMovementLocal,
} from "@/lib/powersync/write-inventory";
import type { CompletedSaleSummary } from "@/lib/receipt";

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
  tracks_inventory: number | null;
  low_stock_threshold: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type CategoryRow = {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type InventoryMovementRow = {
  id: string;
  tenant_id: string;
  product_id: string;
  user_id: string;
  delta: number;
  reason: InventoryMovementReason;
  note: string | null;
  created_at: string;
  client_created_at: string;
};

function rowToProduct(row: ProductRow): Product {
  return mapDbProductToProduct({
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    costCents: row.cost_cents,
    category: row.category,
    imagePath: row.image_path,
    tracksInventory: row.tracks_inventory,
    lowStockThreshold: row.low_stock_threshold,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToInventoryMovement(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    userId: row.user_id,
    delta: row.delta,
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at,
    clientCreatedAt: row.client_created_at,
  };
}

function sortCategories(items: Category[]) {
  return [...items].sort((first, second) =>
    first.name.localeCompare(second.name, "es", { sensitivity: "base" })
  );
}

type GlitterPosAppProps = {
  tenantContext: UserTenantContext;
  initialCategories: Category[];
  initialProducts: Product[];
  initialSales: Sale[];
  initialTenantMembers: TenantMember[];
  initialInventoryMovements: InventoryMovement[];
  activeInvitation: TenantInvitation | null;
  inviteOrigin: string;
};

export function GlitterPosApp({
  tenantContext,
  initialCategories,
  initialProducts,
  initialSales,
  initialTenantMembers,
  initialInventoryMovements,
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
  const hydrateCart = usePosStore((state) => state.hydrateCart);
  const recordSale = usePosStore((state) => state.recordSale);
  const upsertSale = usePosStore((state) => state.upsertSale);
  const hydrateProducts = usePosStore((state) => state.hydrateProducts);
  const hydrateSales = usePosStore((state) => state.hydrateSales);
  const upsertProduct = usePosStore((state) => state.upsertProduct);
  const renameProductCategory = usePosStore(
    (state) => state.renameProductCategory
  );

  const { route, navigate, back } = useAppRoute();
  const view = route.view;
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  useVirtualKeyboard();
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [activeInvitationState, setActiveInvitationState] =
    useState(activeInvitation);
  const [category, setCategory] = useState("Todos");
  const [catalogCategory, setCatalogCategory] = useState("Todos");
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [completedSale, setCompletedSale] =
    useState<CompletedSaleSummary | null>(null);
  const [tenantMembers, setTenantMembers] =
    useState<TenantMember[]>(initialTenantMembers);
  const [inventoryMovements, setInventoryMovements] = useState<
    InventoryMovement[]
  >(initialInventoryMovements);
  const [editorHasInitialMovement, setEditorHasInitialMovement] =
    useState(false);
  const [inventoryWatchReady, setInventoryWatchReady] = useState(
    () => !isPowerSyncConfigured() || initialInventoryMovements.length > 0
  );
  const [teamSyncConfirmed, setTeamSyncConfirmed] = useState(
    () => initialTenantMembers.length === 0
  );
  const initialTenantMembersRef = useRef(initialTenantMembers);
  const teamSyncEverConfirmedRef = useRef(false);
  const [tenantWorkGeneration, setTenantWorkGeneration] = useState(0);
  const tenantWorkGenerationRef = useRef(0);
  const tenantWorkControllerRef = useRef<TenantWorkController | null>(null);
  if (!tenantWorkControllerRef.current) {
    tenantWorkControllerRef.current = new TenantWorkController({
      userId: tenantContext.user.id,
      tenantId: tenantContext.tenant?.id ?? null,
    });
  }
  const draftCartReadyRef = useRef(false);
  // Stable handle for teardown callbacks registered once on mount.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const cartRef = useRef(cart);
  const cartUpdatedAtRef = useRef<string | null>(null);

  const activeProducts = products.filter((product) => !product.archivedAt);
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
  // The editor route carries the product id; `null` means "new product".
  // Memoized so the initial-movement lookup below only reruns when the
  // edited product itself changes.
  const editorProductId = view === "editor" ? (route.id ?? null) : null;
  const editingProduct = useMemo(
    () =>
      editorProductId
        ? (products.find((product) => product.id === editorProductId) ?? null)
        : null,
    [editorProductId, products]
  );
  const editorProductMissing = Boolean(editorProductId && !editingProduct);
  // New products start in the catalog's current filter, else the category
  // of the most recently added product (if it's still a managed category).
  const newProductCategory =
    catalogCategory !== "Todos"
      ? catalogCategory
      : ([...activeProducts]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((product) => product.category)
          .find((name) => categories.some((item) => item.name === name)) ?? "");

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
  const stockByProduct = useMemo(
    () => computeStockByProduct(inventoryMovements, sales),
    [inventoryMovements, sales]
  );
  const activeTenantId = tenantContext.tenant?.id ?? null;

  // Teardown is initiated from Settings, outside this component's local React
  // state. Clear every tenant-derived value immediately so a failed navigation
  // or a recovery screen cannot expose data from the previous account.
  useEffect(() => {
    const stopTenantWork = onLocalDataTeardownStarting(() => {
      cancelTenantWork();
      setIsCheckingOut(false);
    });
    const resumeTenantWork = onLocalDataTeardownFailed(() => {
      tenantWorkControllerRef.current?.resumeAfterFailedTeardown();
      bumpTenantWorkGeneration();
    });
    const clearTenantState = onLocalDataCleared(() => {
      cancelTenantWork();
      draftCartReadyRef.current = false;
      navigateRef.current({ view: "sell" }, { replace: true });
      setCategory("Todos");
      setCatalogCategory("Todos");
      setQuery("");
      setCatalogQuery("");
      setIsCheckingOut(false);
      setCompletedSale(null);
      setActiveInvitationState(null);
      setCategories([]);
      setTenantMembers([]);
      setInventoryMovements([]);
      setInventoryWatchReady(false);
      setTeamSyncConfirmed(false);
      setEditorHasInitialMovement(false);
    });

    return () => {
      stopTenantWork();
      resumeTenantWork();
      clearTenantState();
    };
  }, []);

  // Route states that can't render: the order sheet on desktop (the order
  // panel is always visible there) and a confirmation with no sale behind
  // it (e.g. after a reload).
  useEffect(() => {
    if (view === "cart" && isDesktop) {
      navigate({ view: "sell" }, { replace: true });
    } else if (view === "saleComplete" && !completedSale) {
      navigate({ view: "sell" }, { replace: true });
    }
  }, [view, isDesktop, completedSale, navigate]);

  useEffect(() => {
    initialTenantMembersRef.current = initialTenantMembers;
    teamSyncEverConfirmedRef.current = false;
    setTeamSyncConfirmed(initialTenantMembers.length === 0);
  }, [initialTenantMembers]);

  useEffect(() => {
    hydrateProducts(initialProducts);
    hydrateSales(initialSales);
    setCategories(sortCategories(initialCategories));
    setTenantMembers(initialTenantMembers);
    setInventoryMovements(initialInventoryMovements);
    if (!isPowerSyncConfigured()) {
      setInventoryWatchReady(Boolean(activeTenantId));
    } else {
      setInventoryWatchReady(initialInventoryMovements.length > 0);
    }

    // PowerSyncProvider only renders this tree once this exact identity's
    // local store is ready. Resume after its server-hydrated data is installed.
    const resumed =
      tenantWorkControllerRef.current?.resumeForReadyIdentity({
        userId: tenantContext.user.id,
        tenantId: activeTenantId,
      }) ?? false;
    if (resumed) {
      bumpTenantWorkGeneration();
    }
  }, [
    hydrateProducts,
    hydrateSales,
    initialProducts,
    initialCategories,
    initialSales,
    initialTenantMembers,
    initialInventoryMovements,
    activeTenantId,
    tenantContext.user.id,
  ]);

  useEffect(() => {
    cartRef.current = cart;
    cartUpdatedAtRef.current = usePosStore.getState().cartUpdatedAt;
  }, [cart]);

  // Subscribe to the local PowerSync SQLite store and push updates into
  // Zustand. Server-prop hydration above gives the first paint; this watch
  // takes over once PowerSync has finished its initial sync, then keeps the
  // UI live as new rows replicate down. We gate on `hasSynced` so the first
  // onResult doesn't fire with an empty store and wipe the server data.
  //
  // Tenant filter: sync rules already scope replication by tenant_id and
  // sign-out wipes the local store via disconnectAndClear, but we also
  // filter the read in case a race or a future code path leaves stale
  // rows on disk under a different tenant_id.
  const powerSyncDb = useOptionalPowerSyncDb();
  const inventoryStockReady = inventoryWatchReady;

  function beginTenantWork() {
    return tenantWorkControllerRef.current!.begin();
  }

  function cancelTenantWork() {
    tenantWorkControllerRef.current?.cancel();
    bumpTenantWorkGeneration();
  }

  function bumpTenantWorkGeneration() {
    tenantWorkGenerationRef.current += 1;
    setTenantWorkGeneration(tenantWorkGenerationRef.current);
  }

  useEffect(() => {
    const generation = tenantWorkGenerationRef.current;
    if (!editingProduct) {
      setEditorHasInitialMovement(false);
      return;
    }

    let cancelled = false;
    const isCurrent = () =>
      !cancelled && tenantWorkGenerationRef.current === generation;
    const productId = editingProduct.id;
    const productTracksInventory = editingProduct.tracksInventory;

    async function loadEditorInitialMovementState() {
      if (productHasInitialMovement(productId, inventoryMovements)) {
        if (isCurrent()) {
          setEditorHasInitialMovement(true);
        }
        return;
      }

      if (powerSyncDb?.currentStatus?.hasSynced && inventoryWatchReady) {
        try {
          const hasInitial = await productHasInitialMovementLocal(
            powerSyncDb,
            productId
          );
          if (isCurrent()) {
            setEditorHasInitialMovement(hasInitial);
          }
        } catch (error) {
          if (isCurrent()) {
            console.error("[PowerSync] initial movement lookup failed", error);
          }
        }
        return;
      }

      if (isCurrent()) {
        setEditorHasInitialMovement(
          !inventoryWatchReady && productTracksInventory
        );
      }
    }

    void loadEditorInitialMovementState();

    return () => {
      cancelled = true;
    };
  }, [editingProduct, powerSyncDb, inventoryMovements, inventoryWatchReady]);

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;

    const controller = new AbortController();
    const generation = tenantWorkGenerationRef.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      tenantWorkGenerationRef.current === generation;
    let unregister: (() => void) | undefined;

    function startWatching(db: NonNullable<typeof powerSyncDb>) {
      db.watch(
        "SELECT * FROM products WHERE tenant_id = ? ORDER BY created_at DESC",
        [activeTenantId],
        {
          onResult: (results) => {
            if (!isCurrent() || !db.currentStatus?.hasSynced) {
              return;
            }
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
          if (status.hasSynced && isCurrent()) {
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
  }, [powerSyncDb, hydrateProducts, activeTenantId, tenantWorkGeneration]);

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;

    const controller = new AbortController();
    const generation = tenantWorkGenerationRef.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      tenantWorkGenerationRef.current === generation;
    let unregister: (() => void) | undefined;

    function startWatching(db: NonNullable<typeof powerSyncDb>) {
      db.watch(
        "SELECT * FROM categories WHERE tenant_id = ? ORDER BY name ASC",
        [activeTenantId],
        {
          onResult: (results) => {
            if (!isCurrent() || !db.currentStatus?.hasSynced) return;
            const rows = ((
              results.rows as unknown as { _array?: CategoryRow[] }
            )?._array ?? []) as CategoryRow[];
            setCategories(sortCategories(rows.map(rowToCategory)));
          },
          onError: (error) => {
            console.error("[PowerSync] categories watch error", error);
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
          if (status.hasSynced && isCurrent()) {
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
  }, [powerSyncDb, activeTenantId, tenantWorkGeneration]);

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;

    const controller = new AbortController();
    const generation = tenantWorkGenerationRef.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      tenantWorkGenerationRef.current === generation;
    let unregister: (() => void) | undefined;

    function startWatching(db: NonNullable<typeof powerSyncDb>) {
      db.watch(
        "SELECT * FROM inventory_movements WHERE tenant_id = ? ORDER BY created_at ASC, id ASC",
        [activeTenantId],
        {
          onResult: (results) => {
            if (!isCurrent() || !db.currentStatus?.hasSynced) {
              return;
            }
            const rows = ((
              results.rows as unknown as { _array?: InventoryMovementRow[] }
            )?._array ?? []) as InventoryMovementRow[];
            setInventoryMovements(rows.map(rowToInventoryMovement));
            setInventoryWatchReady(true);
          },
          onError: (error) => {
            console.error("[PowerSync] inventory_movements watch error", error);
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
          if (status.hasSynced && isCurrent()) {
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
  }, [powerSyncDb, activeTenantId, tenantWorkGeneration]);

  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;

    const generation = tenantWorkGenerationRef.current;
    const controller = new AbortController();
    const isCurrent = () =>
      !controller.signal.aborted &&
      tenantWorkGenerationRef.current === generation;
    setTeamSyncConfirmed(initialTenantMembersRef.current.length === 0);
    teamSyncEverConfirmedRef.current = false;
    let unregister: (() => void) | undefined;

    function startWatching(db: NonNullable<typeof powerSyncDb>) {
      db.watch(
        "SELECT * FROM tenant_users WHERE tenant_id = ? ORDER BY created_at ASC, id ASC",
        [activeTenantId],
        {
          onResult: (results) => {
            if (!isCurrent()) {
              return;
            }
            const rows = ((
              results.rows as unknown as { _array?: LocalTenantUserRow[] }
            )?._array ?? []) as LocalTenantUserRow[];
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
          onError: (error) => {
            console.error("[PowerSync] tenant_users watch error", error);
          },
        },
        { signal: controller.signal }
      );
    }

    // Require hasSynced on this connection — do not use hasCompletedInitialSync()
    // here. The localStorage flag can be true from a prior app version that did
    // not replicate tenant_users yet.
    if (powerSyncDb.currentStatus?.hasSynced) {
      startWatching(powerSyncDb);
    } else {
      unregister = powerSyncDb.registerListener({
        statusChanged: (status) => {
          if (status.hasSynced && isCurrent()) {
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
  }, [powerSyncDb, activeTenantId, tenantWorkGeneration]);

  // Subscribe to sales + sale_lines + refunds. PowerSync's onChange fires
  // whenever any of the three tables mutates; we requery all three and
  // rebuild the in-memory Sale[] (same shape as the server-side
  // getSalesForTenant returns). User display names come from synced
  // tenant_users rows (see the watch above).
  const currentUserId = tenantContext.user.id;
  const currentUserName = tenantContext.user.displayName;
  useEffect(() => {
    if (!powerSyncDb || !activeTenantId) return;

    const controller = new AbortController();
    const generation = tenantWorkGenerationRef.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      tenantWorkGenerationRef.current === generation;
    let unregister: (() => void) | undefined;

    function resolveUserName(userId: string) {
      return (
        userNameById.get(userId) ??
        (userId === currentUserId ? currentUserName : "Vendedor")
      );
    }

    async function rebuildSales(db: NonNullable<typeof powerSyncDb>) {
      if (!isCurrent() || !db.currentStatus?.hasSynced) {
        return;
      }
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
        if (!isCurrent()) return;
        hydrateSales(
          buildSalesFromLocal(saleRows, lineRows, refundRows, resolveUserName)
        );
      } catch (error) {
        if (isCurrent()) {
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
          if (status.hasSynced && isCurrent()) {
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
  }, [
    powerSyncDb,
    hydrateSales,
    currentUserId,
    currentUserName,
    activeTenantId,
    userNameById,
    tenantWorkGeneration,
  ]);

  useEffect(() => {
    if (!powerSyncDb) return;
    const db = powerSyncDb;

    const generation = tenantWorkGenerationRef.current;
    let cancelled = false;
    const isCurrent = () =>
      !cancelled && tenantWorkGenerationRef.current === generation;
    draftCartReadyRef.current = false;
    const expectedCartRevision = usePosStore.getState().cartRevision;

    async function hydrateDraftCart() {
      try {
        await migrateLegacyDraftCartLocal(db);
        if (!isCurrent()) return;
        const draft = await loadDraftCartLocal(db);
        if (!isCurrent()) return;

        hydrateCart(draft.cart, draft.updatedAt, expectedCartRevision);
        draftCartReadyRef.current = true;
      } catch (error) {
        if (isCurrent()) {
          console.error("[PowerSync] draft cart hydrate failed", error);
          draftCartReadyRef.current = true;
        }
      }
    }

    void hydrateDraftCart();

    return () => {
      cancelled = true;
    };
  }, [powerSyncDb, hydrateCart, tenantWorkGeneration]);

  useEffect(() => {
    if (!powerSyncDb || !draftCartReadyRef.current) {
      return;
    }

    const generation = tenantWorkGenerationRef.current;
    const timeout = window.setTimeout(() => {
      if (
        tenantWorkGenerationRef.current !== generation ||
        !draftCartReadyRef.current
      ) {
        return;
      }
      void saveDraftCartLocal(
        powerSyncDb,
        cart,
        usePosStore.getState().cartUpdatedAt
      );
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [powerSyncDb, cart, tenantWorkGeneration]);

  useEffect(() => {
    const generation = tenantWorkGenerationRef.current;
    function flushDraftCart() {
      if (
        !powerSyncDb ||
        !draftCartReadyRef.current ||
        tenantWorkGenerationRef.current !== generation
      ) {
        return;
      }

      void saveDraftCartLocal(
        powerSyncDb,
        cartRef.current,
        cartUpdatedAtRef.current
      );
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
  }, [powerSyncDb, tenantWorkGeneration]);

  function showToast(text: string, tone: ToastMessage["tone"] = "success") {
    if (tone === "danger") {
      sonnerToast.error(text);
    } else if (tone === "info") {
      sonnerToast.info(text);
    } else {
      sonnerToast.success(text);
    }
  }

  function openEditor(product: Product | null) {
    navigate({ view: "editor", id: product?.id });
  }

  function closeEditor() {
    back({ view: "products" });
  }

  function goToPrimary(next: PrimaryView) {
    navigate({ view: next });
  }

  async function handleCreateCategory(name: string): Promise<Category> {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      throw new Error("Tu cuenta aún no está configurada.");
    }

    const work = beginTenantWork();
    const db = powerSyncDb;
    const created = db
      ? await createCategoryLocal(db, {
          tenantId: tenant.id,
          name,
          assertCurrent: work.assertCurrent,
        })
      : await createCategoryAction(name);
    work.assertCurrent();
    setCategories((current) =>
      sortCategories([
        created,
        ...current.filter((item) => item.id !== created.id),
      ])
    );
    showToast("Categoría creada", "success");
    return created;
  }

  async function handleRenameCategory(
    categoryId: string,
    name: string
  ): Promise<Category> {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      throw new Error("Tu cuenta aún no está configurada.");
    }
    const currentCategory = categories.find((item) => item.id === categoryId);
    if (!currentCategory) {
      throw new Error("No se encontró la categoría.");
    }

    const work = beginTenantWork();
    const db = powerSyncDb;
    const renamed = db
      ? await renameCategoryLocal(db, {
          tenantId: tenant.id,
          categoryId,
          name,
          assertCurrent: work.assertCurrent,
        })
      : await renameCategoryAction(categoryId, name);
    work.assertCurrent();
    setCategories((current) =>
      sortCategories(
        current.map((item) => (item.id === categoryId ? renamed : item))
      )
    );
    renameProductCategory(currentCategory.name, renamed.name);
    if (category === currentCategory.name) setCategory(renamed.name);
    if (catalogCategory === currentCategory.name) {
      setCatalogCategory(renamed.name);
    }
    showToast("Categoría renombrada", "info");
    return renamed;
  }

  async function handleDeleteCategory(categoryId: string): Promise<void> {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      throw new Error("Tu cuenta aún no está configurada.");
    }
    const currentCategory = categories.find((item) => item.id === categoryId);
    if (!currentCategory) {
      throw new Error("No se encontró la categoría.");
    }

    const work = beginTenantWork();
    const db = powerSyncDb;
    if (db) {
      await deleteCategoryLocal(db, {
        tenantId: tenant.id,
        categoryId,
        assertCurrent: work.assertCurrent,
      });
    } else {
      await deleteCategoryAction(categoryId);
    }
    work.assertCurrent();
    setCategories((current) =>
      current.filter((item) => item.id !== categoryId)
    );
    if (category === currentCategory.name) setCategory("Todos");
    if (catalogCategory === currentCategory.name) setCatalogCategory("Todos");
    showToast("Categoría eliminada", "info");
  }

  async function handleSaveProduct(input: {
    name: string;
    priceCents: number;
    costCents: number | null;
    category: string;
    imageTone: string;
    imagePath?: string | null;
    imageFile?: File | null;
    tracksInventory: boolean;
    initialStock?: number;
  }) {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      showToast("Tu puesto aún no está configurado.", "danger");
      return;
    }
    const work = beginTenantWork();
    const db = powerSyncDb;
    try {
      let uploadFailed = false;
      let initialStockFailed = false;
      let hasInitial = false;
      if (editingProduct) {
        if (productHasInitialMovement(editingProduct.id, inventoryMovements)) {
          hasInitial = true;
        } else if (db?.currentStatus?.hasSynced && inventoryWatchReady) {
          hasInitial = await productHasInitialMovementLocal(
            db,
            editingProduct.id
          );
          work.assertCurrent();
        } else if (!inventoryWatchReady && editingProduct.tracksInventory) {
          hasInitial = true;
        }
      }
      const needsInitialMovement =
        input.tracksInventory &&
        input.initialStock != null &&
        input.initialStock > 0 &&
        !hasInitial;

      if (db) {
        work.assertCurrent();
        const productId = editingProduct
          ? (await updateProductLocal(db, {
              tenantId: tenant.id,
              productId: editingProduct.id,
              product: input,
              assertCurrent: work.assertCurrent,
            }),
            editingProduct.id)
          : (
              await createProductLocal(db, {
                tenantId: tenant.id,
                product: input,
                assertCurrent: work.assertCurrent,
              })
            ).productId;

        if (needsInitialMovement) {
          work.assertCurrent();
          await addInventoryMovement(db, {
            tenantId: tenant.id,
            userId: tenantContext.user.id,
            productId,
            delta: input.initialStock!,
            reason: "initial",
            assertCurrent: work.assertCurrent,
          });
        }

        if (input.imageFile) {
          try {
            work.assertCurrent();
            await uploadProductImageLocal(createSupabaseBrowserClient(), db, {
              tenantId: tenant.id,
              productId,
              file: input.imageFile,
              assertCurrent: work.assertCurrent,
            });
          } catch (error) {
            if (!work.isCurrent()) {
              throw error;
            }
            uploadFailed = true;
          }
        }
      } else {
        work.assertCurrent();
        let product = editingProduct
          ? await updateProductAction(editingProduct.id, input)
          : await createProduct(input);
        work.assertCurrent();

        if (needsInitialMovement) {
          try {
            const movement = await createInventoryMovementAction({
              productId: product.id,
              delta: input.initialStock!,
              reason: "initial",
            });
            work.assertCurrent();
            setInventoryMovements((current) => [...current, movement]);
          } catch (error) {
            if (!work.isCurrent()) {
              throw error;
            }
            initialStockFailed = true;
          }
        }

        if (input.imageFile) {
          const formData = new FormData();
          formData.set("image", input.imageFile);
          try {
            work.assertCurrent();
            product = await uploadProductImage(product.id, formData);
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
      }

      work.assertCurrent();
      if (initialStockFailed && uploadFailed) {
        showToast(
          "Producto guardado, pero no se pudo registrar el stock inicial ni subir la imagen",
          "danger"
        );
      } else if (initialStockFailed) {
        showToast(
          "Producto guardado, pero no se pudo registrar el stock inicial",
          "danger"
        );
      } else if (uploadFailed) {
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
      closeEditor();
    } catch (error) {
      if (!work.isCurrent()) {
        return;
      }
      showToast(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el producto",
        "danger"
      );
    }
  }

  async function handleInventoryMovement(input: {
    productId: string;
    delta: number;
    reason: InventoryMovementReason;
    note?: string;
  }) {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      showToast("Tu puesto aún no está configurado.", "danger");
      return;
    }
    const db = powerSyncDb;
    const work = beginTenantWork();
    try {
      work.assertCurrent();
      if (db) {
        await addInventoryMovement(db, {
          tenantId: tenant.id,
          userId: tenantContext.user.id,
          productId: input.productId,
          delta: input.delta,
          reason: input.reason,
          note: input.note,
          assertCurrent: work.assertCurrent,
        });
        work.assertCurrent();
      } else {
        const movement = await createInventoryMovementAction(input);
        work.assertCurrent();
        setInventoryMovements((current) => [...current, movement]);
      }
      showToast("Inventario actualizado", "success");
    } catch (error) {
      if (!work.isCurrent()) {
        return;
      }
      showToast(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el inventario",
        "danger"
      );
      throw error;
    }
  }

  async function handlePayment({
    method,
    discountCents: discount,
    discountReason: reason,
    receivedCents,
  }: CheckoutPayment) {
    if (isCheckingOut || !cartDetails.length) {
      return;
    }
    const tenant = tenantContext.tenant;
    if (!tenant) {
      showToast("Tu puesto aún no está configurado.", "danger");
      return;
    }

    const work = beginTenantWork();
    const db = powerSyncDb;
    setIsCheckingOut(true);
    // Snapshot the order before the cart is cleared, for the confirmation
    // screen and the shareable receipt.
    const totalCents = Math.max(0, cartSubtotal - discount);
    const summary: Omit<CompletedSaleSummary, "saleId" | "createdAt"> = {
      paymentMethod: method,
      lines: cartDetails.map((line) => {
        const gross = line.product.priceCents * line.quantity;
        return {
          name: line.product.name,
          quantity: line.quantity,
          totalCents: Math.max(
            0,
            gross - clampDiscount(line.lineDiscountCents ?? 0, gross)
          ),
        };
      }),
      itemCount: cartCount,
      subtotalCents: cartSubtotal,
      discountCents: discount,
      totalCents,
      receivedCents: method === "cash" ? receivedCents : null,
      changeCents:
        method === "cash" && receivedCents != null
          ? Math.max(0, receivedCents - totalCents)
          : null,
    };

    try {
      let saleId: string;
      // Local-first when PowerSync is initialized; the watch subscription
      // picks up the new rows and updates the sales list, and the upload
      // queue replicates to Supabase in the background. Fall back to the
      // server action during the brief window before PowerSync is ready.
      if (db) {
        work.assertCurrent();
        ({ saleId } = await createSaleLocal(db, {
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
        }));
        work.assertCurrent();
        clearCart();
        void clearDraftCartLocal(db);
      } else {
        work.assertCurrent();
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
        work.assertCurrent();
        recordSale(sale);
        saleId = sale.id;
      }
      work.assertCurrent();
      // Commit the summary before the route changes: the route store
      // re-renders synchronously, and the confirmation screen redirects to
      // Vender if it renders without a sale.
      flushSync(() =>
        setCompletedSale({
          ...summary,
          saleId,
          createdAt: new Date().toISOString(),
        })
      );
      // Replace checkout so Back from the confirmation doesn't reopen it.
      navigate({ view: "saleComplete" }, { replace: true });
    } catch (error) {
      if (!work.isCurrent()) {
        return;
      }
      showToast(
        error instanceof Error
          ? error.message
          : "No se pudo registrar la venta",
        "danger"
      );
    } finally {
      if (work.isCurrent()) {
        setIsCheckingOut(false);
      }
    }
  }

  async function handleVoidSale(saleId: string) {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      showToast("Tu puesto aún no está configurado.", "danger");
      return false;
    }
    const work = beginTenantWork();
    const db = powerSyncDb;
    try {
      if (db) {
        work.assertCurrent();
        await voidSaleLocal(db, {
          saleId,
          userId: tenantContext.user.id,
          tenantId: tenant.id,
          assertCurrent: work.assertCurrent,
        });
      } else {
        work.assertCurrent();
        const sale = await voidSaleAction(saleId);
        work.assertCurrent();
        upsertSale(sale);
      }
      work.assertCurrent();
      showToast("Venta anulada", "info");
      return true;
    } catch (error) {
      if (!work.isCurrent()) {
        return false;
      }
      showToast(
        error instanceof Error ? error.message : "No se pudo anular la venta",
        "danger"
      );
      return false;
    }
  }

  async function handleRefundSale(saleId: string, reason?: string) {
    const tenant = tenantContext.tenant;
    if (!tenant) {
      showToast("Tu puesto aún no está configurado.", "danger");
      return false;
    }
    const work = beginTenantWork();
    const db = powerSyncDb;
    try {
      if (db) {
        work.assertCurrent();
        await refundSaleLocal(db, {
          saleId,
          userId: tenantContext.user.id,
          tenantId: tenant.id,
          reason,
          assertCurrent: work.assertCurrent,
        });
      } else {
        work.assertCurrent();
        const sale = await refundSaleAction(saleId, reason);
        work.assertCurrent();
        upsertSale(sale);
      }
      work.assertCurrent();
      showToast("Reembolso registrado", "info");
      return true;
    } catch (error) {
      if (!work.isCurrent()) {
        return false;
      }
      showToast(
        error instanceof Error
          ? error.message
          : "No se pudo registrar el reembolso",
        "danger"
      );
      return false;
    }
  }

  function handleClearCart() {
    clearCart();
    if (powerSyncDb) {
      void clearDraftCartLocal(powerSyncDb);
    }
    showToast("Pedido vaciado", "info");
    if (view === "cart") {
      back({ view: "sell" });
    }
  }

  function openSaleDetail(saleId: string) {
    navigate({ view: "saleDetail", id: saleId });
  }

  const orderSheetOpen = view === "cart" && !isDesktop;
  const sellScreen = (
    <SellScreen
      products={activeProducts}
      categories={categoryNames}
      stockByProduct={stockByProduct}
      inventoryStockReady={inventoryStockReady}
      category={category}
      query={query}
      setCategory={setCategory}
      setQuery={setQuery}
      order={{
        lines: cartDetails,
        subtotal: cartSubtotal,
        count: cartCount,
        addToCart,
        decrementCart,
        removeFromCart,
        setLineDiscount,
        clearCart: handleClearCart,
        charge: () => navigate({ view: "checkout" }),
      }}
      orderSheetOpen={orderSheetOpen}
      openOrderSheet={() => navigate({ view: "cart" })}
      closeOrderSheet={() => back({ view: "sell" })}
      openProductEditor={() => openEditor(null)}
    />
  );

  // One element for both routes so the list keeps its filters and scroll
  // position while a sale's detail opens beside it (or over it on phones).
  const salesScreen = (
    <SalesScreen
      sales={sales}
      selectedSaleId={view === "saleDetail" ? (route.id ?? null) : null}
      openSale={(saleId) =>
        navigate(
          { view: "saleDetail", id: saleId },
          // Switching between sales shouldn't stack history entries.
          { replace: view === "saleDetail" }
        )
      }
      closeSale={() => back({ view: "sales" })}
      voidSale={handleVoidSale}
      refundSale={handleRefundSale}
    />
  );

  const content: Record<View, ReactNode> = {
    sell: sellScreen,
    cart: sellScreen,
    reports: (
      <ReportsScreen
        sales={sales}
        products={activeProducts}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
      />
    ),
    sales: salesScreen,
    saleDetail: salesScreen,
    products: (
      <ProductsScreen
        products={products}
        categories={categoryNames}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        category={catalogCategory}
        query={catalogQuery}
        setCategory={setCatalogCategory}
        setQuery={setCatalogQuery}
        openEditor={openEditor}
        openCategories={() => navigate({ view: "categories" })}
        restoreProduct={async (productId) => {
          const tenant = tenantContext.tenant;
          if (!tenant) {
            showToast("Tu puesto aún no está configurado.", "danger");
            return;
          }
          const work = beginTenantWork();
          const db = powerSyncDb;
          try {
            if (db) {
              work.assertCurrent();
              await restoreProductLocal(db, {
                tenantId: tenant.id,
                productId,
                assertCurrent: work.assertCurrent,
              });
            } else {
              work.assertCurrent();
              const product = await restoreProductAction(productId);
              work.assertCurrent();
              upsertProduct(product);
            }
            work.assertCurrent();
            showToast("Producto restaurado", "info");
          } catch (error) {
            if (!work.isCurrent()) {
              return;
            }
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
    categories: (
      <CategoriesScreen
        categories={categories}
        products={products}
        back={() => back({ view: "products" })}
        createCategory={handleCreateCategory}
        renameCategory={handleRenameCategory}
        deleteCategory={handleDeleteCategory}
      />
    ),
    more: (
      <MoreScreen
        tenantContext={tenantContext}
        openSettings={() => navigate({ view: "settings" })}
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
        openDiagnostics={() => navigate({ view: "diagnostics" })}
        back={() => back({ view: "more" })}
      />
    ),
    checkout: (
      <CheckoutScreen
        lines={cartDetails}
        subtotal={cartSubtotal}
        count={cartCount}
        back={() => back({ view: "sell" })}
        pay={handlePayment}
        isSubmitting={isCheckingOut}
      />
    ),
    saleComplete: completedSale ? (
      <SaleCompleteScreen
        sale={completedSale}
        storeName={tenantContext.tenant?.name}
        newSale={() => navigate({ view: "sell" }, { replace: true })}
        openSale={openSaleDetail}
        notify={showToast}
      />
    ) : null,
    editor: editorProductMissing ? (
      <MissingRecordScreen
        title="Producto no encontrado"
        body="El producto ya no está disponible en este dispositivo."
        back={closeEditor}
      />
    ) : (
      <ProductEditor
        key={editorProductId ?? "new"}
        product={editingProduct}
        categories={categories}
        defaultCategory={newProductCategory}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        hasInitialMovement={editorHasInitialMovement}
        onInventoryMovement={handleInventoryMovement}
        back={closeEditor}
        createCategory={handleCreateCategory}
        save={handleSaveProduct}
        archive={async (productId) => {
          const tenant = tenantContext.tenant;
          if (!tenant) {
            showToast("Tu puesto aún no está configurado.", "danger");
            return;
          }
          const work = beginTenantWork();
          const db = powerSyncDb;
          try {
            if (db) {
              work.assertCurrent();
              await archiveProductLocal(db, {
                tenantId: tenant.id,
                productId,
                assertCurrent: work.assertCurrent,
              });
            } else {
              work.assertCurrent();
              const product = await archiveProductAction(productId);
              work.assertCurrent();
              upsertProduct(product);
            }
            work.assertCurrent();
            showToast("Producto archivado", "info");
            closeEditor();
          } catch (error) {
            if (!work.isCurrent()) {
              return;
            }
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
    diagnostics: (
      <DiagnosticsScreen
        tenantContext={tenantContext}
        localCounts={{
          activeProducts: activeProducts.length,
          archivedProducts: products.length - activeProducts.length,
          completedSales: sales.filter((sale) => sale.status === "completed")
            .length,
          saleRecords: sales.length,
        }}
        back={() => back({ view: "settings" })}
      />
    ),
  };
  const activePrimary = primaryViewFor(view);

  return (
    // --app-height is set by useVirtualKeyboard while the keyboard is open.
    <div className="flex h-[var(--app-height,100dvh)] overflow-hidden bg-background">
      <SideNav
        active={activePrimary}
        onNavigate={goToPrimary}
        tenantName={tenantContext.tenant?.name}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="relative min-h-0 flex-1">{content[view]}</main>
        {isPrimaryView(view) ? (
          <BottomNav active={activePrimary} onNavigate={goToPrimary} />
        ) : null}
      </div>
      <Toaster
        richColors
        // Phones: top, clear of the checkout bar and bottom nav.
        position={isDesktop ? "bottom-right" : "top-center"}
        duration={2600}
      />
    </div>
  );
}
