"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { toast as sonnerToast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { BottomNav } from "@/components/organisms/bottom-nav";
import { CartScreen } from "@/components/screens/cart-screen";
import { PaymentScreen } from "@/components/screens/payment-screen";
import { ProductEditor } from "@/components/screens/product-editor";
import { ProductsScreen } from "@/components/screens/products-screen";
import { ReportsScreen } from "@/components/screens/reports-screen";
import { SaleDetailScreen } from "@/components/screens/sale-detail-screen";
import { SalesScreen } from "@/components/screens/sales-screen";
import { SellScreen } from "@/components/screens/sell-screen";
import { MoreScreen } from "@/components/screens/more-screen";
import { SettingsScreen } from "@/components/screens/settings-screen";
import { DiagnosticsScreen } from "@/components/screens/diagnostics-screen";
import { unwrapActionResult } from "@/lib/action-result";
import { paymentLabels, saleTotal } from "@/lib/sales";
import { cartSubtotalCents } from "@/lib/sales/pricing";
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
  CartLine,
  PaymentMethod,
  Product,
  Sale,
  TenantInvitation,
  TenantMember,
  ToastMessage,
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
import {
  clearDraftCartLocal,
  loadDraftCartLocal,
  migrateLegacyDraftCartLocal,
  saveDraftCartLocal,
} from "@/lib/powersync/draft-cart";
import { onLocalDataEvent } from "@/lib/powersync/local-data-teardown";
import { TenantWorkController } from "@/lib/powersync/tenant-work";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  computeStockByProduct,
  productHasInitialMovement,
  resolveInitialStockDelta,
  type InventoryMovement,
  type InventoryMovementReason,
} from "@/lib/inventory";
import {
  addInventoryMovement,
  productHasInitialMovementLocal,
} from "@/lib/powersync/write-inventory";
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
  tracks_inventory: number | null;
  low_stock_threshold: number | null;
  archived_at: string | null;
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

type GlitterPosAppProps = {
  tenantContext: UserTenantContext;
  initialProducts: Product[];
  initialSales: Sale[];
  initialTenantMembers: TenantMember[];
  initialInventoryMovements: InventoryMovement[];
  activeInvitation: TenantInvitation | null;
  inviteOrigin: string;
};

export function GlitterPosApp({
  tenantContext,
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

  const [view, setView] = useState<View>("sell");
  const [activeInvitationState, setActiveInvitationState] =
    useState(activeInvitation);
  const [previousView, setPreviousView] = useState<View>("products");
  const [category, setCategory] = useState("Todos");
  const [catalogCategory, setCatalogCategory] = useState("Todos");
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [saleDetailReturnView, setSaleDetailReturnView] = useState<
    "sales" | "reports"
  >("sales");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  // The server-action checkout's sale id, kept while the same checkout is
  // retried (see handlePayment).
  const checkoutAttemptRef = useRef<{ key: string; saleId: string } | null>(
    null
  );
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
  const cartRef = useRef(cart);
  const cartUpdatedAtRef = useRef<string | null>(null);

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
  const stockByProduct = useMemo(
    () => computeStockByProduct(inventoryMovements, sales),
    [inventoryMovements, sales]
  );
  const activeTenantId = tenantContext.tenant?.id ?? null;

  // Teardown is initiated from Settings, outside this component's local React
  // state. Clear every tenant-derived value immediately so a failed navigation
  // or a recovery screen cannot expose data from the previous account.
  useEffect(() => {
    const stopTenantWork = onLocalDataEvent("teardown-starting", () => {
      cancelTenantWork();
      setIsCheckingOut(false);
    });
    const resumeTenantWork = onLocalDataEvent("teardown-failed", () => {
      tenantWorkControllerRef.current?.resumeAfterFailedTeardown();
      bumpTenantWorkGeneration();
    });
    const clearTenantState = onLocalDataEvent("cleared", () => {
      cancelTenantWork();
      draftCartReadyRef.current = false;
      setView("sell");
      setPreviousView("products");
      setCategory("Todos");
      setCatalogCategory("Todos");
      setQuery("");
      setCatalogQuery("");
      setEditingProduct(null);
      setSelectedSaleId(null);
      setSaleDetailReturnView("sales");
      setIsCheckingOut(false);
      setActiveInvitationState(null);
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

  useEffect(() => {
    initialTenantMembersRef.current = initialTenantMembers;
    teamSyncEverConfirmedRef.current = false;
    setTeamSyncConfirmed(initialTenantMembers.length === 0);
  }, [initialTenantMembers]);

  useEffect(() => {
    hydrateProducts(initialProducts);
    hydrateSales(initialSales);
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
    setPreviousView(view === "editor" ? "products" : view);
    setEditingProduct(product);
    setView("editor");
  }

  function openImport() {
    showToast("La importación desde Excel aún no está disponible.", "info");
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
      showToast("Tu cuenta aún no está configurada.", "danger");
      return;
    }
    // The image and the initial count are written separately, so they stay
    // out of the product fields (and out of the server action's arguments).
    const { imageFile, initialStock, ...productInput } = input;
    const work = beginTenantWork();
    const db = powerSyncDb;
    try {
      let uploadFailed = false;
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
      const initialStockDelta = resolveInitialStockDelta({
        tracksInventory: input.tracksInventory,
        wasTrackingInventory: editingProduct?.tracksInventory ?? false,
        hasInitialMovement: hasInitial,
        initialStock,
      });
      const needsInitialMovement = initialStockDelta != null;

      const inventoryPersistenceRequired =
        !db &&
        input.tracksInventory &&
        (needsInitialMovement ||
          !editingProduct ||
          !editingProduct.tracksInventory);
      if (inventoryPersistenceRequired) {
        showToast(
          "Conecta para guardar productos con inventario activado.",
          "danger"
        );
        return;
      }

      if (db) {
        work.assertCurrent();
        const productId = editingProduct
          ? (await updateProductLocal(db, {
              tenantId: tenant.id,
              productId: editingProduct.id,
              product: productInput,
              assertCurrent: work.assertCurrent,
            }),
            editingProduct.id)
          : (
              await createProductLocal(db, {
                tenantId: tenant.id,
                product: productInput,
                assertCurrent: work.assertCurrent,
              })
            ).productId;

        if (needsInitialMovement) {
          work.assertCurrent();
          await addInventoryMovement(db, {
            tenantId: tenant.id,
            userId: tenantContext.user.id,
            productId,
            delta: initialStockDelta,
            reason: "initial",
            assertCurrent: work.assertCurrent,
          });
        }

        if (imageFile) {
          try {
            work.assertCurrent();
            await uploadProductImageLocal(createSupabaseBrowserClient(), db, {
              tenantId: tenant.id,
              productId,
              file: imageFile,
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
        let product = await unwrapActionResult(
          () =>
            editingProduct
              ? updateProductAction(tenant.id, editingProduct.id, productInput)
              : createProduct(tenant.id, productInput),
          "No se pudo guardar el producto"
        );
        work.assertCurrent();

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
      }

      work.assertCurrent();
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
      showToast("Tu cuenta aún no está configurada.", "danger");
      return;
    }
    const db = powerSyncDb;
    if (!db) {
      showToast("Conecta para ajustar el inventario.", "info");
      return;
    }
    const work = beginTenantWork();
    try {
      work.assertCurrent();
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

  async function handlePayment(
    method: PaymentMethod,
    discount: number,
    reason?: string
  ) {
    if (isCheckingOut || !cartDetails.length) {
      return;
    }
    const tenant = tenantContext.tenant;
    if (!tenant) {
      showToast("Tu cuenta aún no está configurada.", "danger");
      return;
    }

    const work = beginTenantWork();
    const db = powerSyncDb;
    setIsCheckingOut(true);

    try {
      // Local-first when PowerSync is ready: the watch subscription picks up
      // the new rows and updates the sales list, and the upload queue
      // replicates to Supabase in the background. Without PowerSync
      // (local-only mode, when it is not configured) the server action
      // records the sale.
      if (db) {
        work.assertCurrent();
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
        void clearDraftCartLocal(db);
        showToast(
          `Venta registrada · ${formatBs(totalCents, true)} · ${paymentLabels[method]}`
        );
      } else {
        work.assertCurrent();
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
            saleId: crypto.randomUUID(),
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
        showToast(
          `Venta registrada · ${saleTotal(sale)} · ${paymentLabels[method]}`
        );
      }
      work.assertCurrent();
      setView("sell");
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
      showToast("Tu cuenta aún no está configurada.", "danger");
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
        const sale = await unwrapActionResult(
          () => voidSaleAction(tenant.id, saleId),
          "No se pudo anular la venta"
        );
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
      showToast("Tu cuenta aún no está configurada.", "danger");
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
        const sale = await unwrapActionResult(
          () => refundSaleAction(tenant.id, saleId, reason),
          "No se pudo registrar el reembolso"
        );
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

  function openSaleDetail(saleId: string, returnView: "sales" | "reports") {
    setSelectedSaleId(saleId);
    setSaleDetailReturnView(returnView);
    setView("saleDetail");
  }

  const content = {
    sell: (
      <SellScreen
        products={activeProducts}
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
        openPayment={() => setView("payment")}
        openProductEditor={() => openEditor(null)}
      />
    ),
    reports: (
      <ReportsScreen
        sales={sales}
        products={activeProducts}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        openSales={() => setView("sales")}
      />
    ),
    sales: (
      <SalesScreen
        sales={sales}
        openSale={(saleId) => openSaleDetail(saleId, "sales")}
        voidSale={handleVoidSale}
        refundSale={handleRefundSale}
      />
    ),
    products: (
      <ProductsScreen
        products={products}
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        category={catalogCategory}
        query={catalogQuery}
        userDisplayName={tenantContext.user.displayName}
        userEmail={tenantContext.user.email}
        setCategory={setCatalogCategory}
        setQuery={setCatalogQuery}
        openEditor={openEditor}
        onImport={openImport}
        restoreProduct={async (productId) => {
          const tenant = tenantContext.tenant;
          if (!tenant) {
            showToast("Tu cuenta aún no está configurada.", "danger");
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
              const product = await unwrapActionResult(
                () => restoreProductAction(tenant.id, productId),
                "No se pudo restaurar el producto"
              );
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
        openDiagnostics={() => {
          setPreviousView("settings");
          setView("diagnostics");
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
        setLineDiscount={setLineDiscount}
        clearCart={() => {
          clearCart();
          if (powerSyncDb) {
            void clearDraftCartLocal(powerSyncDb);
          }
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
        stockByProduct={stockByProduct}
        inventoryStockReady={inventoryStockReady}
        hasInitialMovement={editorHasInitialMovement}
        onInventoryMovement={handleInventoryMovement}
        back={() =>
          setView(previousView === "sell" ? "products" : previousView)
        }
        save={handleSaveProduct}
        archive={async (productId) => {
          const tenant = tenantContext.tenant;
          if (!tenant) {
            showToast("Tu cuenta aún no está configurada.", "danger");
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
              const product = await unwrapActionResult(
                () => archiveProductAction(tenant.id, productId),
                "No se pudo archivar el producto"
              );
              work.assertCurrent();
              upsertProduct(product);
            }
            work.assertCurrent();
            showToast("Producto archivado", "info");
            setView("products");
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
    saleDetail: (
      <SaleDetailScreen
        sale={selectedSale}
        sales={sales}
        back={() => setView(saleDetailReturnView)}
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
