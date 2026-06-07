import { BarChart3, Box, Settings, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import type { View } from "@/lib/views";

type BottomNavProps = {
  view: View;
  setView: (view: View) => void;
};

export function BottomNav({ view, setView }: BottomNavProps) {
  const items: { view: View; label: string; icon: ReactNode }[] = [
    { view: "sell", label: "Vender", icon: <ShoppingBag size={22} /> },
    { view: "reports", label: "Reportes", icon: <BarChart3 size={22} /> },
    { view: "products", label: "Productos", icon: <Box size={22} /> },
    { view: "settings", label: "Ajustes", icon: <Settings size={22} /> },
  ];

  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {items.map((item) => (
        <button
          key={item.view}
          className={view === item.view ? "active" : ""}
          onClick={() => setView(item.view)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
