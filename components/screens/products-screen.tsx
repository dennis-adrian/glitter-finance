import { Download, PackagePlus, Plus, Search } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryRail } from "@/components/molecules/category-rail";
import { EmptyState } from "@/components/molecules/empty-state";
import { ProductCatalogCard } from "@/components/molecules/product-catalog-card";
import { categories } from "@/lib/sample-data";
import type { Product } from "@/lib/types";
import { getProductStock } from "@/lib/inventory";

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

export function ProductsScreen(props: ProductsScreenProps) {
  const filtered = props.products.filter((product) => {
    const matchesCategory =
      props.category === "Todos" || product.category === props.category;
    const matchesQuery = product.name
      .toLowerCase()
      .includes(props.query.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <section className="screen">
      <Header
        title="Glitter POS"
        left={<BrandMark />}
        right={
          <span
            className="grid size-10 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary"
            aria-label="Perfil"
          >
            JD
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
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<PackagePlus size={46} />}
          title="Nada por aquí todavía"
          body="Tu inventario está esperando brillar."
          action={
            <Button
              size="lg"
              className="rounded-2xl font-extrabold tracking-wide"
              onClick={() => props.openEditor(null)}
            >
              <Plus className="size-5" />
              AGREGAR TU PRIMER PRODUCTO
            </Button>
          }
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
      <Button
        variant="ghost"
        className="absolute bottom-[88px] left-1/2 -translate-x-1/2 text-primary hover:text-primary"
      >
        <Download className="size-4" />
        Importar desde Excel
      </Button>
    </section>
  );
}
