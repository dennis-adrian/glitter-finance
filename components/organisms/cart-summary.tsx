import { BadgeDollarSign, Trash2 } from "lucide-react";
import { formatBs } from "@/lib/money";

type CartSummaryProps = {
  itemCount: number;
  subtotal: number;
  clearCart: () => void;
  back: () => void;
  charge: () => void;
};

export function CartSummary({
  itemCount,
  subtotal,
  clearCart,
  back,
  charge,
}: CartSummaryProps) {
  return (
    <div className="cart-summary">
      <span>Subtotal ({itemCount} productos)</span>
      <div className="summary-row">
        <strong>Total: {formatBs(subtotal, true)}</strong>
        <button className="clear-button" onClick={clearCart}>
          <Trash2 size={16} />
          Vaciar
        </button>
      </div>
      <button className="primary-action" disabled={!itemCount} onClick={charge}>
        <BadgeDollarSign size={21} />
        COBRAR
      </button>
      <button className="secondary-action" onClick={back}>
        Agregar más productos
      </button>
    </div>
  );
}
