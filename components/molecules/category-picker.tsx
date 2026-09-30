"use client";

import { Plus } from "lucide-react";
import type { CategoryOption } from "@/lib/products";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

type CategoryPickerProps = {
  /** Selected option id ("" when none). */
  value: string;
  onChange: (value: string) => void;
  /** The puesto's categories. */
  categories: Category[];
  /**
   * The product's current category when it isn't among `categories` (e.g.
   * not synced to this device yet). Shown so saving doesn't change it.
   */
  currentCategory?: CategoryOption | null;
  /** Opens the "new category" form. */
  onCreate: () => void;
  labelledBy?: string;
};

const chipClassName =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[13px] font-bold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Pick one of the puesto's categories as chips, or create a new one. */
export function CategoryPicker({
  value,
  onChange,
  categories,
  currentCategory,
  onCreate,
  labelledBy,
}: CategoryPickerProps) {
  const options: CategoryOption[] = categories.map((category) => ({
    id: category.id,
    label: category.name,
  }));
  if (
    currentCategory &&
    !options.some((option) => option.id === currentCategory.id)
  ) {
    options.unshift(currentCategory);
  }

  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-labelledby={labelledBy}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              chipClassName,
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/60 text-primary hover:bg-primary/10"
            )}
          >
            {option.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onCreate}
        className={cn(
          chipClassName,
          "border-dashed border-border text-muted-foreground hover:text-foreground"
        )}
      >
        <Plus className="size-3.5" aria-hidden />
        Nueva categoría
      </button>
    </div>
  );
}
