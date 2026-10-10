import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  type ProductStock,
  stockAriaLabel,
  stockBadgeLabel,
  stockNeedsGlyph,
} from "@/lib/inventory";

/** A tracked product's stock, in the top-left corner of its card. */
export function StockBadge({ stock }: { stock: ProductStock }) {
  return (
    <Badge
      variant={stock.state === "oversold" ? "destructive" : "secondary"}
      className="absolute top-2 left-2 h-6 gap-1 rounded-full font-semibold"
      aria-label={stockAriaLabel(stock)}
    >
      {stockNeedsGlyph(stock.state) ? (
        <TriangleAlert aria-hidden="true" />
      ) : null}
      {stockBadgeLabel(stock)}
    </Badge>
  );
}
