import { Download, PackagePlus, Plus, Search } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { CategoryRail } from "@/components/molecules/category-rail";
import { EmptyState } from "@/components/molecules/empty-state";
import { ProductCatalogCard } from "@/components/molecules/product-catalog-card";
import { categories } from "@/lib/sample-data";
import type { Product } from "@/lib/types";

type ProductsScreenProps = {
  products: Product[];
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
    <section className="screen products-screen">
      <Header
        title="Glitter POS"
        left={<BrandMark />}
        right={
          <button className="avatar" aria-label="Perfil">
            JD
          </button>
        }
      />
      <div className="search-panel">
        <Search size={20} />
        <input
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="Buscar productos..."
        />
      </div>
      <CategoryRail
        active={props.category}
        categories={categories}
        setActive={props.setCategory}
      />
      {filtered.length ? (
        <div className="product-grid catalog-grid">
          {filtered.map((product) => (
            <ProductCatalogCard
              key={product.id}
              product={product}
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
            <button
              className="primary-action"
              onClick={() => props.openEditor(null)}
            >
              <Plus size={20} />
              AGREGAR TU PRIMER PRODUCTO
            </button>
          }
        />
      )}
      <button
        className="floating-add"
        onClick={() => props.openEditor(null)}
        aria-label="Agregar producto"
      >
        <Plus size={31} />
      </button>
      <button className="import-link">
        <Download size={16} />
        Importar desde Excel
      </button>
    </section>
  );
}
