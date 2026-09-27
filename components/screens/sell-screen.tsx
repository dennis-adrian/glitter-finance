import { useRef } from "react";
import { PackagePlus, Search } from "lucide-react";
import { CategoryRail } from "@/components/molecules/category-rail";
import { EmptyState } from "@/components/molecules/empty-state";
import { ProductTile } from "@/components/molecules/product-tile";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { CheckoutBar } from "@/components/organisms/checkout-bar";
import {
  OrderPanel,
  type OrderPanelProps,
} from "@/components/organisms/order-panel";
import { Screen } from "@/components/templates/screen";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { TABLET_QUERY, useMediaQuery } from "@/lib/hooks/use-media-query";
import { useSearchShortcut } from "@/lib/hooks/use-search-shortcut";
import { deriveCategories, isSameCategory } from "@/lib/products";
import type { Product } from "@/lib/types";

type SellScreenProps = {
  products: Product[];
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  category: string;
  query: string;
  setCategory: (value: string) => void;
  setQuery: (value: string) => void;
  /** Order data and actions, shared by the side panel and the sheet. */
  order: Omit<OrderPanelProps, "onClose" | "className">;
  /** Phones/tablets: the order sheet is open (route `#/pedido`). */
  orderSheetOpen: boolean;
  openOrderSheet: () => void;
  closeOrderSheet: () => void;
  openProductEditor: () => void;
};

/**
 * Selling register. Desktop (lg+) shows the product grid with a persistent
 * order panel; phones and tablets show a checkout bar that opens the order
 * in a sheet (bottom on phones, side on tablets).
 */
export function SellScreen(props: SellScreenProps) {
  const isTablet = useMediaQuery(TABLET_QUERY);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);
  const { order } = props;
  const quantities = new Map(
    order.lines.map((line) => [line.productId, line.quantity])
  );
  const categories = deriveCategories(props.products);
  // A category can disappear (its last product archived); fall back to all.
  const activeCategory =
    props.category !== "Todos" &&
    categories.some((category) => isSameCategory(category, props.category))
      ? props.category
      : "Todos";
  const normalizedQuery = props.query.trim().toLowerCase();
  const filtered = props.products.filter((product) => {
    const matchesCategory =
      activeCategory === "Todos" ||
      isSameCategory(product.category, activeCategory);
    const matchesQuery = product.name.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="flex h-full min-h-0">
      <Screen
        className="min-w-0 flex-1"
        header={
          <ScreenHeader
            title="Vender"
            center={
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={props.query}
                  onChange={(event) => props.setQuery(event.target.value)}
                  placeholder="Buscar producto"
                  aria-label="Buscar producto"
                  aria-keyshortcuts="/"
                  ref={searchRef}
                  className="rounded-full pl-11 lg:pr-12"
                />
                {props.query ? null : (
                  <kbd className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 rounded-md border border-border px-1.5 text-xs text-muted-foreground lg:block">
                    /
                  </kbd>
                )}
              </div>
            }
          >
            {categories.length > 1 ? (
              <CategoryRail
                active={activeCategory}
                categories={["Todos", ...categories]}
                setActive={props.setCategory}
              />
            ) : (
              <div className="pb-3" />
            )}
          </ScreenHeader>
        }
        footer={
          <CheckoutBar
            count={order.count}
            subtotal={order.subtotal}
            openOrder={props.openOrderSheet}
            charge={order.charge}
          />
        }
        footerClassName="lg:hidden"
      >
        {filtered.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 md:gap-4">
            {filtered.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                stockByProduct={props.stockByProduct}
                inventoryStockReady={props.inventoryStockReady}
                quantity={quantities.get(product.id) ?? 0}
                add={() => order.addToCart(product.id)}
                decrement={() => order.decrementCart(product.id)}
              />
            ))}
          </div>
        ) : props.products.length === 0 ? (
          <EmptyState
            icon={<PackagePlus size={42} />}
            title="Agregá tu primer producto"
            body="Tu catálogo está vacío."
            action={
              <Button size="lg" onClick={props.openProductEditor}>
                <PackagePlus className="size-5" />
                Agregar producto
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Search size={42} />}
            title="No se encontraron productos"
            body="Probá con otra categoría o término de búsqueda."
          />
        )}
      </Screen>

      <aside
        className="hidden w-[22rem] shrink-0 border-l border-border bg-card lg:flex xl:w-[25rem]"
        aria-label="Pedido actual"
      >
        <OrderPanel {...order} className="w-full" />
      </aside>

      <Drawer
        open={props.orderSheetOpen}
        onOpenChange={(open) => {
          if (!open) props.closeOrderSheet();
        }}
        swipeDirection={isTablet ? "right" : "down"}
        showSwipeHandle={!isTablet}
      >
        <DrawerContent className="data-[swipe-axis=x]:w-[min(26rem,90vw)]">
          <DrawerTitle className="sr-only">Pedido</DrawerTitle>
          <DrawerDescription className="sr-only">
            Productos del pedido actual y total a cobrar.
          </DrawerDescription>
          <OrderPanel
            {...order}
            onClose={props.closeOrderSheet}
            className="min-h-0 flex-1"
          />
        </DrawerContent>
      </Drawer>
    </div>
  );
}
