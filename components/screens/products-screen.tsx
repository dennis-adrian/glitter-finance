import { PackagePlus, Plus, Search } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryRail } from "@/components/molecules/category-rail";
import { EmptyState } from "@/components/molecules/empty-state";
import { ProductCatalogCard } from "@/components/molecules/product-catalog-card";
import { categories } from "@/lib/categories";
import { filterProducts } from "@/lib/products";
import type { Product } from "@/lib/types";
import { getProductStock } from "@/lib/inventory";

type ProductsScreenProps = {
  products: Product[];
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  category: string;
  query: string;
  userDisplayName?: string;
  userEmail?: string | null;
  setCategory: (value: string) => void;
  setQuery: (value: string) => void;
  openEditor: (product: Product | null) => void;
  restoreProduct: (productId: string) => void;
  /** A product save, archive or restore is still running. */
  productWritePending: boolean;
  restoringProductId: string | null;
};

export function ProductsScreen(props: ProductsScreenProps) {
  const identity = props.userDisplayName || props.userEmail || null;
  const initials = identity ? identity.slice(0, 2).toUpperCase() : "?";

  const filtered = filterProducts(props.products, props.category, props.query);

  return (
    <section className="screen">
      <Header
        title="Billetera Ferial"
        left={<BrandMark decorative />}
        right={
          <span
            className="grid size-10 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary"
            role="img"
            aria-label={identity ? `Perfil de ${identity}` : "Perfil"}
          >
            {initials}
          </span>
        }
      />
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="Buscar productos..."
          aria-label="Buscar productos"
          className="h-12 rounded-2xl pl-11"
        />
      </div>
      <CategoryRail
        active={props.category}
        categories={categories}
        setActive={props.setCategory}
      />
      {filtered.length ? (
        <div className="grid grid-cols-2 gap-3.5 pb-20">
          {filtered.map((product) => (
            <ProductCatalogCard
              key={product.id}
              product={product}
              stock={
                props.inventoryStockReady
                  ? getProductStock(product, props.stockByProduct)
                  : null
              }
              openEditor={props.openEditor}
              restoreProduct={props.restoreProduct}
              restoreDisabled={props.productWritePending}
              restoring={props.restoringProductId === product.id}
            />
          ))}
        </div>
      ) : props.products.length === 0 ? (
        <EmptyState
          icon={<PackagePlus size={46} />}
          title="Nada por aquí todavía"
          body="Tu inventario está esperando brillar."
          action={
            <Button
              size="lg"
              className="font-extrabold tracking-wide"
              onClick={() => props.openEditor(null)}
            >
              <Plus className="size-5" />
              AGREGAR TU PRIMER PRODUCTO
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<Search size={46} />}
          title="No se encontraron productos"
          body="Prueba con otra categoría o término de búsqueda."
        />
      )}
      <Button
        size="icon"
        onClick={() => props.openEditor(null)}
        aria-label="Agregar producto"
        className="absolute right-[18px] bottom-[84px] size-16 rounded-full shadow-lg shadow-primary/30"
      >
        <Plus className="size-8" />
      </Button>
    </section>
  );
}
