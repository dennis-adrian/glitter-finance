"use client";

import { Plus } from "lucide-react";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

type CategoryPickerProps = {
  /** Selected category name ("" when none). */
  value: string;
  onChange: (value: string) => void;
  /** The puesto's managed categories. */
  categories: Category[];
  /**
   * A category the product already has that isn't a managed category (from
   * before categories were managed). Shown so saving doesn't silently change it.
   */
  legacyCategory?: string | null;
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
  legacyCategory,
  onCreate,
  labelledBy,
}: CategoryPickerProps) {
  const names = categories.map((category) => category.name);
  if (legacyCategory && !names.includes(legacyCategory)) {
    names.unshift(legacyCategory);
  }

  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-labelledby={labelledBy}
    >
      {names.map((name) => {
        const selected = name === value;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(name)}
            className={cn(
              chipClassName,
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/60 text-primary hover:bg-primary/10"
            )}
          >
            {name}
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
