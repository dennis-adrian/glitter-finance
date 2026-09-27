"use client";

import { useState } from "react";
import {
  Archive,
  PackagePlus,
  Plus,
  Search,
  TriangleAlert,
} from "lucide-react";
import { ProductArt } from "@/components/atoms/product-art";
import { CategoryRail } from "@/components/molecules/category-rail";
import { EmptyState } from "@/components/molecules/empty-state";
import { ProductCatalogCard } from "@/components/molecules/product-catalog-card";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { SegmentedControl } from "@/components/molecules/segmented-control";
import { Screen } from "@/components/templates/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getProductStock,
  stockBadgeLabel,
  stockNeedsGlyph,
  type ProductStock,
} from "@/lib/inventory";
import { formatBs } from "@/lib/money";
import { deriveCategories, isSameCategory } from "@/lib/products";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

type CatalogStatus = "active" | "archived";

type ProductsScreenProps = {
  products: Product[];
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  category: string;
  query: string;
  setCategory: (value: string) => void;
  setQuery: (value: string) => void;
  openEditor: (product: Product | null) => void;
  restoreProduct: (productId: string) => void;
};

/**
 * Catalog management. Phones and tablets show image cards; desktop shows a
 * table with category, price, cost, and stock. Categories are the vendor's
 * own (derived from their products).
 */
export function ProductsScreen(props: ProductsScreenProps) {
  const [status, setStatus] = useState<CatalogStatus>("active");
  const activeProducts = props.products.filter(
    (product) => !product.archivedAt
  );
  const archivedProducts = props.products.filter(
    (product) => product.archivedAt
  );
  const inStatus = status === "active" ? activeProducts : archivedProducts;
  const categories = deriveCategories(inStatus);
  // A category can disappear (last product archived); fall back to all.
  const activeCategory =
    props.category !== "Todos" &&
    categories.some((category) => isSameCategory(category, props.category))
      ? props.category
      : "Todos";
  const normalizedQuery = props.query.trim().toLowerCase();
  const filtered = inStatus.filter((product) => {
    const matchesCategory =
      activeCategory === "Todos" ||
      isSameCategory(product.category, activeCategory);
    const matchesQuery = product.name.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });
  const stockFor = (product: Product) =>
    props.inventoryStockReady
      ? getProductStock(product, props.stockByProduct)
      : null;

  return (
    <Screen
      header={
        <ScreenHeader
          title="Catálogo"
          actions={
            <>
              <Button
                type="button"
                size="icon-sm"
                className="md:hidden"
                onClick={() => props.openEditor(null)}
                aria-label="Nuevo producto"
              >
                <Plus className="size-5" />
              </Button>
              <Button
                type="button"
                size="sm"
                className="hidden md:inline-flex"
                onClick={() => props.openEditor(null)}
              >
                <Plus className="size-4" />
                Nuevo producto
              </Button>
            </>
          }
        >
          <div className="grid gap-3 pb-3 md:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={props.query}
                onChange={(event) => props.setQuery(event.target.value)}
                placeholder="Buscar productos"
                aria-label="Buscar productos"
                className="rounded-full pl-11"
              />
            </div>
            <SegmentedControl<CatalogStatus>
              aria-label="Estado de los productos"
              value={status}
              onChange={setStatus}
              options={[
                {
                  value: "active",
                  label: `Activos (${activeProducts.length})`,
                },
                {
                  value: "archived",
                  label: `Archivados (${archivedProducts.length})`,
                },
              ]}
            />
          </div>
          {categories.length > 1 ? (
            <CategoryRail
              active={activeCategory}
              categories={["Todos", ...categories]}
              setActive={props.setCategory}
            />
          ) : null}
        </ScreenHeader>
      }
    >
      {filtered.length ? (
        <>
          {/* Phones and tablets: cards */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 md:gap-4 lg:hidden">
            {filtered.map((product) => (
              <ProductCatalogCard
                key={product.id}
                product={product}
                stock={stockFor(product)}
                openEditor={props.openEditor}
                restoreProduct={props.restoreProduct}
              />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/10 lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {status === "active"
                  ? "Productos activos"
                  : "Productos archivados"}
              </caption>
              <thead className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                <tr>
                  <th scope="col" className="py-3 pr-3 pl-5 font-semibold">
                    Producto
                  </th>
                  <th scope="col" className="px-3 font-semibold">
                    Categoría
                  </th>
                  <th scope="col" className="px-3 text-right font-semibold">
                    Precio
                  </th>
                  <th scope="col" className="px-3 text-right font-semibold">
                    Costo
                  </th>
                  <th scope="col" className="px-3 font-semibold">
                    Stock
                  </th>
                  <th scope="col" className="py-3 pr-5 pl-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <CatalogRow
                    key={product.id}
                    product={product}
                    stock={stockFor(product)}
                    openEditor={props.openEditor}
                    restoreProduct={props.restoreProduct}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : props.products.length === 0 ? (
        <EmptyState
          icon={<PackagePlus size={46} />}
          title="Todavía no hay productos"
          body="Agregá lo que vendés para empezar a cobrar."
          action={
            <Button size="lg" onClick={() => props.openEditor(null)}>
              <Plus className="size-5" />
              Agregar producto
            </Button>
          }
        />
      ) : status === "archived" && archivedProducts.length === 0 ? (
        <EmptyState
          icon={<Archive size={46} />}
          title="No hay productos archivados"
          body="Los productos que archives aparecen acá y los podés restaurar."
        />
      ) : (
        <EmptyState
          icon={<Search size={46} />}
          title="No se encontraron productos"
          body="Probá con otra categoría o término de búsqueda."
        />
      )}
    </Screen>
  );
}

function CatalogRow({
  product,
  stock,
  openEditor,
  restoreProduct,
}: {
  product: Product;
  stock: ProductStock | null;
  openEditor: (product: Product) => void;
  restoreProduct: (productId: string) => void;
}) {
  const stockAlert = stock?.state === "out" || stock?.state === "oversold";

  return (
    <tr
      className={cn(
        "cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/50",
        product.archivedAt && "text-muted-foreground"
      )}
      onClick={() => openEditor(product)}
    >
      <td className="py-2.5 pr-3 pl-5">
        <div className="flex items-center gap-3">
          <ProductArt product={product} thumb />
          <button
            type="button"
            className="min-w-0 truncate text-left font-semibold text-foreground outline-none hover:underline focus-visible:underline"
            onClick={(event) => {
              event.stopPropagation();
              openEditor(product);
            }}
          >
            {product.name}
          </button>
        </div>
      </td>
      <td className="px-3 text-muted-foreground">{product.category}</td>
      <td className="px-3 text-right font-semibold text-primary tabular-nums">
        {formatBs(product.priceCents, true)}
      </td>
      <td className="px-3 text-right text-muted-foreground tabular-nums">
        {product.costCents == null ? "—" : formatBs(product.costCents, true)}
      </td>
      <td className="px-3">
        {stock ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              stockAlert
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-foreground"
            )}
          >
            {stockNeedsGlyph(stock.state) ? (
              <TriangleAlert className="size-3" aria-hidden />
            ) : null}
            {stockBadgeLabel(stock)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-2.5 pr-5 pl-3 text-right">
        {product.archivedAt ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              restoreProduct(product.id);
            }}
          >
            Restaurar
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
