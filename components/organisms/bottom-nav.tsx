import { Ellipsis, LayoutGrid, ReceiptText, ShoppingCart } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { View } from "@/lib/views";

type BottomNavProps = {
  view: View;
  setView: (view: View) => void;
};

export function BottomNav({ view, setView }: BottomNavProps) {
  const items: { view: View; label: string; icon: ReactNode }[] = [
    {
      view: "sell",
      label: "POS Venta",
      icon: <ShoppingCart className="size-5" />,
    },
    {
      view: "sales",
      label: "Ventas",
      icon: <ReceiptText className="size-5" />,
    },
    {
      view: "products",
      label: "Catálogo",
      icon: <LayoutGrid className="size-5" />,
    },
    {
      view: "more",
      label: "Más",
      icon: <Ellipsis className="size-5" />,
    },
  ];

  return (
    <nav
      className="absolute inset-x-0 bottom-0 z-30 grid min-h-[66px] grid-cols-4 border-t border-border bg-card pt-2.5 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-8px_22px_rgba(22,16,35,0.04)]"
      aria-label="Navegación principal"
    >
      {items.map((item) => {
        const active =
          view === item.view ||
          (item.view === "more" && ["reports", "settings"].includes(view));
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => setView(item.view)}
            className={cn(
              "flex min-w-0 flex-col items-center justify-start gap-1 px-1 text-[11px] leading-none transition-colors",
              active ? "font-bold text-primary" : "text-muted-foreground"
            )}
            aria-current={active ? "page" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
