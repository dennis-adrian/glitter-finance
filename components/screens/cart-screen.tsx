import { ShoppingBag } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { BackButton } from "@/components/atoms/back-button";
import { Header } from "@/components/atoms/header";
import { CartLineItem } from "@/components/molecules/cart-line-item";
import { EmptyState } from "@/components/molecules/empty-state";
import { CartSummary } from "@/components/organisms/cart-summary";
import type { CartLine, Product } from "@/lib/types";

type CartScreenProps = {
  cartDetails: (CartLine & { product: Product })[];
  subtotal: number;
  decrementCart: (productId: string) => void;
  addToCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  setLineDiscount: (
    productId: string,
    lineDiscountCents: number,
    lineDiscountReason?: string
  ) => void;
  clearCart: () => void;
  back: () => void;
  charge: () => void;
};

export function CartScreen(props: CartScreenProps) {
  const itemCount = props.cartDetails.reduce(
    (count, line) => count + line.quantity,
    0
  );

  return (
    <section className="screen cart-screen">
      <Header
        title="Tu Carrito"
        left={<BackButton back={props.back} />}
        right={<BrandMark size="small" />}
      />
      <div className="grid gap-3">
        {props.cartDetails.map((line) => (
          <CartLineItem
            key={line.productId}
            productId={line.productId}
            quantity={line.quantity}
            product={line.product}
            decrementCart={props.decrementCart}
            addToCart={props.addToCart}
            removeFromCart={props.removeFromCart}
            lineDiscountCents={line.lineDiscountCents ?? 0}
            lineDiscountReason={line.lineDiscountReason}
            setLineDiscount={props.setLineDiscount}
          />
        ))}
      </div>
      {!props.cartDetails.length ? (
        <EmptyState
          icon={<ShoppingBag size={46} />}
          title="Carrito vacío"
          body="Tocá productos para empezar una venta."
        />
      ) : null}
      <CartSummary
        itemCount={itemCount}
        subtotal={props.subtotal}
        clearCart={props.clearCart}
        back={props.back}
        charge={props.charge}
      />
    </section>
  );
}
