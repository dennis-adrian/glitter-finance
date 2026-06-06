import { ReceiptText } from "lucide-react";
import { formatBs } from "@/lib/money";

type CheckoutDockProps = {
  cartCount: number;
  cartSubtotal: number;
  openCart: () => void;
  openPayment: () => void;
};

export function CheckoutDock({ cartCount, cartSubtotal, openCart, openPayment }: CheckoutDockProps) {
  return (
    <div className="checkout-dock">
      <button className="order-button" onClick={openCart} aria-label="Ver carrito">
        <ReceiptText size={22} />
        {cartCount ? <span className="badge">{cartCount}</span> : null}
      </button>
      <button className="charge-button" disabled={!cartCount} onClick={openPayment}>
        <span>COBRAR</span>
        <strong>{formatBs(cartSubtotal, true)}</strong>
      </button>
    </div>
  );
}
