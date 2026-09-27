"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CATEGORY_MAX_LENGTH, isSameCategory } from "@/lib/products";
import { cn } from "@/lib/utils";

type CategoryPickerProps = {
  /** Current category name (may be a new, not-yet-saved one). */
  value: string;
  onChange: (value: string) => void;
  /** Categories already used by this vendor's products. */
  categories: string[];
  labelledBy?: string;
};

const chipClassName =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[13px] font-bold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Pick one of the vendor's own categories or type a new one. Categories
 * are just the names products use, so a new one appears everywhere as soon
 * as a product is saved with it.
 */
export function CategoryPicker({
  value,
  onChange,
  categories,
  labelledBy,
}: CategoryPickerProps) {
  const matchesExisting = categories.some((category) =>
    isSameCategory(category, value)
  );
  const [creating, setCreating] = useState(
    () => categories.length === 0 || (Boolean(value) && !matchesExisting)
  );

  return (
    <div className="grid gap-2.5">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-labelledby={labelledBy}
      >
        {categories.map((category) => {
          const selected = !creating && isSameCategory(category, value);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setCreating(false);
                onChange(category);
              }}
              className={cn(
                chipClassName,
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/60 text-primary hover:bg-primary/10"
              )}
            >
              {category}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={creating}
          onClick={() => {
            if (!creating) onChange("");
            setCreating(true);
          }}
          className={cn(
            chipClassName,
            creating
              ? "border-primary bg-primary text-primary-foreground"
              : "border-dashed border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <Plus className="size-3.5" aria-hidden />
          Nueva categoría
        </button>
      </div>
      {creating ? (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={CATEGORY_MAX_LENGTH}
          placeholder="Ej. Llaveros, Tote bags…"
          aria-label="Nombre de la nueva categoría"
          autoFocus={categories.length > 0}
        />
      ) : null}
    </div>
  );
}
