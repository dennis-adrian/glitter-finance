import { Button } from "@/components/ui/button";

type CategoryRailProps = {
  categories: string[];
  active: string;
  setActive: (category: string) => void;
};

export function CategoryRail({
  categories,
  active,
  setActive,
}: CategoryRailProps) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {categories.map((item) => (
        <Button
          key={item}
          type="button"
          size="sm"
          variant={active === item ? "default" : "outline"}
          className="h-9 shrink-0 rounded-full px-4"
          onClick={() => setActive(item)}
        >
          {item}
        </Button>
      ))}
    </div>
  );
}
