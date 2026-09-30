"use client";

import { useMemo, useState } from "react";
import { Hash, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { BackButton } from "@/components/atoms/back-button";
import { Header } from "@/components/atoms/header";
import { CategoryFormDrawer } from "@/components/molecules/category-form-drawer";
import { EmptyState } from "@/components/molecules/empty-state";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { countLabel } from "@/lib/plural";
import type { Category, Product } from "@/lib/types";

type CategoriesScreenProps = {
  categories: Category[];
  products: Product[];
  back: () => void;
  /** Resolve to null when the write was cancelled (see runTenantWrite). */
  createCategory: (name: string) => Promise<Category | null>;
  renameCategory: (
    categoryId: string,
    name: string
  ) => Promise<Category | null>;
  deleteCategory: (categoryId: string) => Promise<void>;
};

export function CategoriesScreen({
  categories,
  products,
  back,
  createCategory,
  renameCategory,
  deleteCategory,
}: CategoriesScreenProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const productCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    }
    return counts;
  }, [products]);

  function openCreate() {
    setEditingCategory(null);
    setFormOpen(true);
  }

  function openRename(category: Category) {
    setEditingCategory(category);
    setFormOpen(true);
  }

  async function confirmDelete() {
    if (!deletingCategory || deletePending) return;
    setDeleteError(null);
    setDeletePending(true);
    try {
      await deleteCategory(deletingCategory.id);
      setDeletingCategory(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar la categoría."
      );
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <section className="screen">
      <Header
        title="Categorías"
        left={<BackButton back={back} />}
        right={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={openCreate}
            aria-label="Crear categoría"
          >
            <Plus />
          </Button>
        }
      />

      <div className="mb-4 rounded-2xl bg-primary/8 p-4 ring-1 ring-primary/15">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Tags className="size-5" />
          </span>
          <div>
            <h2 className="font-heading text-base font-bold">
              Ordená tu catálogo a tu manera
            </h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Podés crear y renombrar categorías. Para eliminar una, primero
              mové sus productos.
            </p>
          </div>
        </div>
      </div>

      {categories.length ? (
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          {categories.map((category) => {
            const productCount = productCountByCategory.get(category.name) ?? 0;
            const isUsed = productCount > 0;
            return (
              <div
                key={category.id}
                className="flex min-h-[72px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Hash className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[15px] font-bold">
                    {category.name}
                  </strong>
                  <span className="text-[13px] text-muted-foreground">
                    {countLabel(productCount, "producto", "productos")}
                  </span>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => openRename(category)}
                  aria-label={`Renombrar ${category.name}`}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="destructive"
                  disabled={isUsed}
                  title={
                    isUsed
                      ? "Mové sus productos antes de eliminarla"
                      : "Eliminar categoría"
                  }
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingCategory(category);
                  }}
                  aria-label={`Eliminar ${category.name}`}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Tags size={46} />}
          title="Creá tu primera categoría"
          body="Las categorías que crees aparecerán al agregar productos."
          action={
            <Button
              size="lg"
              className="font-extrabold tracking-wide"
              onClick={openCreate}
            >
              <Plus className="size-5" />
              CREAR CATEGORÍA
            </Button>
          }
        />
      )}

      <CategoryFormDrawer
        open={formOpen}
        category={editingCategory}
        existingNames={categories.map((category) => category.name)}
        onOpenChange={setFormOpen}
        onSave={(name) =>
          editingCategory
            ? renameCategory(editingCategory.id, name)
            : createCategory(name)
        }
      />

      <Drawer
        open={Boolean(deletingCategory)}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeletingCategory(null);
        }}
        showSwipeHandle
      >
        <DrawerContent className="mx-auto max-w-[448px]">
          <DrawerHeader className="px-5 pt-2 text-left">
            <DrawerTitle className="text-left text-xl font-bold">
              ¿Eliminar “{deletingCategory?.name}”?
            </DrawerTitle>
            <DrawerDescription className="text-left">
              Dejará de aparecer al crear o editar productos. Esta acción no se
              puede deshacer.
            </DrawerDescription>
          </DrawerHeader>
          {deleteError ? (
            <p className="px-5 pt-3 text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DrawerFooter className="grid grid-cols-2 gap-2.5 px-5 pt-5 pb-5">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={deletePending}
              onClick={() => setDeletingCategory(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="lg"
              disabled={deletePending}
              onClick={() => void confirmDelete()}
            >
              <Trash2 />
              {deletePending ? "Eliminando…" : "Eliminar"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </section>
  );
}
