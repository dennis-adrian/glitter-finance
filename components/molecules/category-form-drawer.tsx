"use client";

import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  categoryNameMaxLength,
  categoryNamesMatch,
  validateCategoryName,
} from "@/lib/categories/validation";
import type { Category } from "@/lib/types";

type CategoryFormDrawerProps = {
  open: boolean;
  category?: Category | null;
  existingNames: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<Category>;
};

export function CategoryFormDrawer({
  open,
  category = null,
  existingNames,
  onOpenChange,
  onSave,
}: CategoryFormDrawerProps) {
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const editing = Boolean(category);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setError(null);
  }, [open, category]);

  async function submit() {
    if (isPending) return;

    let normalizedName: string;
    try {
      normalizedName = validateCategoryName(name);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Revisa el nombre de la categoría."
      );
      return;
    }

    const hasDuplicate = existingNames.some(
      (existingName) =>
        !categoryNamesMatch(existingName, category?.name ?? "") &&
        categoryNamesMatch(existingName, normalizedName)
    );
    if (hasDuplicate) {
      setError("Ya existe una categoría con ese nombre.");
      return;
    }

    setError(null);
    setIsPending(true);
    try {
      await onSave(normalizedName);
      onOpenChange(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar la categoría."
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
      showSwipeHandle
    >
      <DrawerContent className="mx-auto max-w-[448px]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DrawerHeader className="px-5 pt-2 text-left">
            <DrawerTitle className="font-heading text-xl font-extrabold text-primary">
              {editing ? "Renombrar categoría" : "Nueva categoría"}
            </DrawerTitle>
            <DrawerDescription className="text-left">
              {editing
                ? "El nuevo nombre se aplicará también a sus productos."
                : "Úsala para ordenar el catálogo y encontrar productos más rápido."}
            </DrawerDescription>
          </DrawerHeader>

          <div className="px-5 pt-5">
            <label
              htmlFor="category-name"
              className="mb-1.5 block text-sm font-semibold"
            >
              Nombre
            </label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej.: Cuadernos"
              maxLength={categoryNameMaxLength}
              autoComplete="off"
              autoFocus
              disabled={isPending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "category-name-error" : undefined}
              className="h-13 rounded-xl"
            />
            <div className="mt-1.5 flex min-h-5 justify-between gap-3 text-xs">
              <p
                id="category-name-error"
                role={error ? "alert" : undefined}
                className={error ? "text-destructive" : "text-transparent"}
              >
                {error ?? "Sin error"}
              </p>
              <span className="shrink-0 text-muted-foreground">
                {name.length}/{categoryNameMaxLength}
              </span>
            </div>
          </div>

          <DrawerFooter className="grid grid-cols-2 gap-2.5 px-5 pt-4 pb-5">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="lg" disabled={isPending}>
              {editing ? <Save /> : <Plus />}
              {isPending ? "Guardando…" : editing ? "Guardar" : "Crear"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
