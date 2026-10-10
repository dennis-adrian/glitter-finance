import {
  BarChart3,
  Ellipsis,
  LayoutGrid,
  ReceiptText,
  Store,
  type LucideIcon,
} from "lucide-react";
import type { PrimaryView } from "@/lib/views";

export const navItems: {
  view: PrimaryView;
  label: string;
  icon: LucideIcon;
}[] = [
  { view: "sell", label: "Vender", icon: Store },
  { view: "sales", label: "Ventas", icon: ReceiptText },
  { view: "products", label: "Catálogo", icon: LayoutGrid },
  { view: "reports", label: "Reportes", icon: BarChart3 },
  { view: "more", label: "Más", icon: Ellipsis },
];
