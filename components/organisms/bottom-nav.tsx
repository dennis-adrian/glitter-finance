import {
  BarChart3,
  Box,
  ReceiptText,
  Settings,
  ShoppingBag,
} from "lucide-react";
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
      label: "Vender",
      icon: <ShoppingBag className="size-[22px]" />,
    },
    {
      view: "sales",
      label: "Ventas",
      icon: <ReceiptText className="size-[22px]" />,
    },
    {
      view: "products",
      label: "Productos",
      icon: <Box className="size-[22px]" />,
    },
    {
      view: "reports",
      label: "Reportes",
      icon: <BarChart3 className="size-[22px]" />,
    },
    {
      view: "settings",
      label: "Ajustes",
      icon: <Settings className="size-[22px]" />,
    },
  ];

  return (
    <nav
      className="absolute inset-x-0 bottom-0 z-30 grid h-[66px] grid-cols-5 border-t border-border bg-card shadow-[0_-8px_22px_rgba(22,16,35,0.06)]"
      aria-label="Navegación principal"
    >
      {items.map((item) => {
        const active = view === item.view;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => setView(item.view)}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] transition-colors",
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
