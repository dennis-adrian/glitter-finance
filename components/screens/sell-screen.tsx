import { PackagePlus, Search } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { CategoryRail } from "@/components/molecules/category-rail";
import { EmptyState } from "@/components/molecules/empty-state";
import { ProductTile } from "@/components/molecules/product-tile";
import { CheckoutDock } from "@/components/organisms/checkout-dock";
import { categories } from "@/lib/sample-data";
import type { Product } from "@/lib/types";

type SellScreenProps = {
  products: Product[];
  cartCount: number;
  cartSubtotal: number;
  cart: { productId: string; quantity: number }[];
  category: string;
  query: string;
  setCategory: (value: string) => void;
  setQuery: (value: string) => void;
  addToCart: (productId: string) => void;
  decrementCart: (productId: string) => void;
  openCart: () => void;
  openPayment: () => void;
};

export function SellScreen(props: SellScreenProps) {
  const filtered = props.products.filter((product) => {
    const matchesCategory =
      props.category === "Todos" || product.category === props.category;
    const matchesQuery = product.name
      .toLowerCase()
      .includes(props.query.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <section className="screen sell-screen">
      <Header
        title="Glitter POS"
        left={<BrandMark />}
        right={
          <button className="icon-button" aria-label="Buscar">
            <Search size={22} />
          </button>
        }
      />
      <div className="sell-status">
        <span className="status-dot" />
        <span>Modo venta · listo sin conexión</span>
      </div>
      <CategoryRail
        active={props.category}
        categories={categories}
        setActive={props.setCategory}
      />
      <div className="search-panel compact">
        <Search size={18} />
        <input
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="Buscar producto"
        />
      </div>
      {filtered.length ? (
        <div className="product-grid">
          {filtered.map((product) => {
            const quantity =
              props.cart.find((line) => line.productId === product.id)
                ?.quantity ?? 0;
            return (
              <ProductTile
                key={product.id}
                product={product}
                quantity={quantity}
                add={() => props.addToCart(product.id)}
                decrement={() => props.decrementCart(product.id)}
              />
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<PackagePlus size={42} />}
          title="Nada por aquí todavía"
          body="Cambia de categoría o agrega un producto nuevo desde Productos."
        />
      )}
      <CheckoutDock
        cartCount={props.cartCount}
        cartSubtotal={props.cartSubtotal}
        openCart={props.openCart}
        openPayment={props.openPayment}
      />
    </section>
  );
}
