import { Button } from "@/components/ui/button";
import type { CategoryOption } from "@/lib/products";

type CategoryRailProps = {
  categories: CategoryOption[];
  /** Id of the selected option. */
  active: string;
  setActive: (id: string) => void;
};

export function CategoryRail({
  categories,
  active,
  setActive,
}: CategoryRailProps) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pt-1 pb-3.5 [-ms-overflow-style:none] [scrollbar-width:none] md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden">
      {categories.map((item) => (
        <Button
          key={item.id}
          type="button"
          size="sm"
          variant={active === item.id ? "default" : "outline"}
          aria-pressed={active === item.id}
          className="shrink-0 rounded-full px-4"
          onClick={() => setActive(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
