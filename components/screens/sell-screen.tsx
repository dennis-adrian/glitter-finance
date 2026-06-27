import { PackagePlus, Search } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryRail } from "@/components/molecules/category-rail";
import { EmptyState } from "@/components/molecules/empty-state";
import { ProductTile } from "@/components/molecules/product-tile";
import { CheckoutDock } from "@/components/organisms/checkout-dock";
import { categories } from "@/lib/sample-data";
import type { Product } from "@/lib/types";

type SellScreenProps = {
  products: Product[];
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
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
  openProductEditor: () => void;
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
    <section className="screen">
      <Header title="Glitter POS" left={<BrandMark />} />

      <CategoryRail
        active={props.category}
        categories={categories}
        setActive={props.setCategory}
      />

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="Buscar producto"
          aria-label="Buscar producto"
          className="h-12 rounded-2xl pl-11"
        />
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-2 gap-3.5">
          {filtered.map((product) => {
            const quantity =
              props.cart.find((line) => line.productId === product.id)
                ?.quantity ?? 0;
            return (
              <ProductTile
                key={product.id}
                product={product}
                stockByProduct={props.stockByProduct}
                inventoryStockReady={props.inventoryStockReady}
                quantity={quantity}
                add={() => props.addToCart(product.id)}
                decrement={() => props.decrementCart(product.id)}
              />
            );
          })}
        </div>
      ) : props.products.length === 0 ? (
        <EmptyState
          icon={<PackagePlus size={42} />}
          title="Agrega tu primer producto"
          body="Tu catálogo está vacío."
          action={
            <Button
              size="lg"
              onClick={props.openProductEditor}
              className="rounded-2xl font-extrabold tracking-wide"
            >
              <PackagePlus className="size-5" />
              AGREGAR PRODUCTO
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<Search size={42} />}
          title="No se encontraron productos"
          body="Prueba con otra categoría o término de búsqueda."
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
