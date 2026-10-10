"use client";

import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import {
  Archive,
  Camera,
  Check,
  Edit3,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { FormField } from "@/components/atoms/form-field";
import { ProductArt } from "@/components/atoms/product-art";
import { CategoryFormDrawer } from "@/components/molecules/category-form-drawer";
import { CategoryPicker } from "@/components/molecules/category-picker";
import { ConfirmDialog } from "@/components/molecules/confirm-dialog";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { SegmentedControl } from "@/components/molecules/segmented-control";
import { Screen } from "@/components/templates/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  asksForInitialStock,
  getProductStock,
  stockValueLabel,
  type InitialMovementState,
  type InventoryMovementReason,
} from "@/lib/inventory";
import {
  defaultPlaceholderImageTone,
  placeholderImageToneLabels,
  placeholderImageTones,
  productImageAccept,
  productImageFileError,
  productImageFormatsLabel,
} from "@/lib/product-image-config";
import { downscaleProductImage } from "@/lib/product-image-downscale";
import {
  categoryIndex,
  effectiveCategoryId,
  emptyProduct,
  PRODUCT_NAME_MAX_LENGTH,
} from "@/lib/products";
import type { Category, Product, ProductInput } from "@/lib/types";
import { MAX_NOTE_LENGTH } from "@/lib/validation";
import {
  INITIAL_STOCK_ERROR,
  initialStockHint,
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseSignedInteger,
  stockAmountError,
  validateProductForm,
} from "@/components/screens/product-editor.helpers";

// Selection value for a product whose category isn't linked by id yet and
// isn't available on this device.
const currentCategoryValue = "current";

/**
 * What a save sends: the product fields the editor owns (no low-stock
 * threshold, which a save must keep), the reduced photo, uploaded on its own
 * after the product is written, and the initial count. `categoryId` is null
 * when an edited product keeps its category, so a category not synced to
 * this device yet is never replaced.
 */
export type ProductEditorSaveInput = {
  product: Required<
    Pick<
      ProductInput,
      | "name"
      | "priceCents"
      | "costCents"
      | "categoryId"
      | "imageTone"
      | "imagePath"
      | "tracksInventory"
    >
  >;
  imageFile: File | null;
  initialStock?: number;
};

export type ProductEditorProps = {
  product: Product | null;
  /** The puesto's managed categories. */
  categories: Category[];
  /** Preselected category id for new products. */
  defaultCategoryId?: string;
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  /** Whether the product already has its initial count. */
  initialMovement: InitialMovementState;
  /**
   * A product write still running: this editor's save or archive, or
   * another one ("busy"), such as a restore from the catalog or a save from
   * an editor closed since. One runs at a time, so both buttons wait for it.
   */
  pendingWrite: "save" | "archive" | "busy" | null;
  back: () => void;
  /**
   * Creates a category from the editor and resolves to it, to select it, or
   * to null when the write was cancelled.
   */
  createCategory: (name: string) => Promise<Category | null>;
  save: (input: ProductEditorSaveInput) => Promise<void>;
  /** Throws the message to show when the movement was not recorded. */
  onInventoryMovement: (input: {
    productId: string;
    delta: number;
    reason: InventoryMovementReason;
    note?: string;
  }) => Promise<void>;
  archive: (productId: string) => Promise<void>;
};

type StockCorrection = "adjustment" | "loss" | "gift";

const STOCK_CORRECTIONS: Record<
  StockCorrection,
  { label: string; hint: string; placeholder: string; action: string }
> = {
  adjustment: {
    label: "Ajuste",
    hint: "Corregí el conteo: un número positivo suma, uno negativo resta.",
    placeholder: "Ej. -2 o +3",
    action: "Registrar ajuste",
  },
  loss: {
    label: "Pérdida",
    hint: "Unidades dañadas, perdidas o robadas.",
    placeholder: "Ej. 2",
    action: "Registrar pérdida",
  },
  gift: {
    label: "Regalo",
    hint: "Unidades entregadas sin cobrar.",
    placeholder: "Ej. 1",
    action: "Registrar regalo",
  },
};

/** Price/cost field with a fixed "Bs" prefix. */
function MoneyInput(props: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
        Bs
      </span>
      <Input inputMode="decimal" {...props} className="pl-11" />
    </div>
  );
}

export function ProductEditor({
  product,
  categories,
  defaultCategoryId = "",
  stockByProduct,
  inventoryStockReady,
  initialMovement,
  pendingWrite,
  back,
  createCategory,
  save,
  onInventoryMovement,
  archive,
}: ProductEditorProps) {
  // Values the form started from, to detect unsaved changes. The editor is
  // keyed by product id, so these are fixed for its lifetime.
  const [initial] = useState(() => ({
    name: product?.name ?? "",
    price: product ? String(product.priceCents / 100) : "",
    cost: product?.costCents == null ? "" : String(product.costCents / 100),
    categoryId: product
      ? (effectiveCategoryId(product, categoryIndex(categories)) ??
        currentCategoryValue)
      : defaultCategoryId,
    imageTone: product?.imageTone ?? defaultPlaceholderImageTone,
    tracksInventory: product?.tracksInventory ?? false,
  }));
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(initial.price);
  const [cost, setCost] = useState(initial.cost);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [imageTone, setImageTone] = useState(initial.imageTone);
  const [tracksInventory, setTracksInventory] = useState(
    initial.tracksInventory
  );
  const [initialStock, setInitialStock] = useState("");
  const [restockAmount, setRestockAmount] = useState("");
  const [correction, setCorrection] = useState<StockCorrection>("adjustment");
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [inventoryActionError, setInventoryActionError] = useState<
    string | null
  >(null);
  const [inventoryMovementSubmitting, setInventoryMovementSubmitting] =
    useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Counts picks, so a slow reduction of an earlier photo cannot replace a
  // later one.
  const imagePickRef = useRef(0);
  const fieldId = useId();
  const ids = {
    tone: `${fieldId}-tone`,
    toneLabel: `${fieldId}-tone-label`,
    category: `${fieldId}-category`,
    nameError: `${fieldId}-name-error`,
    priceError: `${fieldId}-price-error`,
    costError: `${fieldId}-cost-error`,
    restock: `${fieldId}-restock`,
    restockError: `${fieldId}-restock-error`,
    correctionError: `${fieldId}-correction-error`,
  };
  // The product's category as it was, when it isn't available on this device
  // (not synced yet); keeping it selected saves without changing it.
  const currentCategory =
    product && !categories.some((item) => item.id === initial.categoryId)
      ? { id: initial.categoryId, label: product.category }
      : null;
  const hasCategory =
    categories.some((item) => item.id === categoryId) ||
    (currentCategory !== null && categoryId === currentCategory.id);
  const productForm = validateProductForm({ name, price, cost });
  const canSave = productForm.values != null && hasCategory;
  const saving = pendingWrite === "save";
  const trackingPersisted = product?.tracksInventory ?? false;
  const trackingDirty =
    Boolean(product) && tracksInventory !== trackingPersisted;
  const showInitialStockField = asksForInitialStock({
    tracksInventory,
    wasTrackingInventory: trackingPersisted,
    initialMovement,
  });
  const currentStock =
    product && trackingPersisted && inventoryStockReady
      ? getProductStock(product, stockByProduct)
      : null;
  const canRestock = parsePositiveInteger(restockAmount) != null;
  const canCorrect =
    (correction === "adjustment"
      ? parseSignedInteger(correctionAmount)
      : parsePositiveInteger(correctionAmount)) != null;
  const restockError = stockAmountError(restockAmount);
  const correctionError = stockAmountError(
    correctionAmount,
    correction === "adjustment"
  );
  const isDirty =
    name !== initial.name ||
    price !== initial.price ||
    cost !== initial.cost ||
    categoryId !== initial.categoryId ||
    imageTone !== initial.imageTone ||
    tracksInventory !== initial.tracksInventory ||
    Boolean(imageFile) ||
    Boolean(initialStock.trim());
  const previewProduct = {
    ...(product ?? emptyProduct),
    name: name || "Producto",
    imageTone,
    tracksInventory,
    imagePath: product?.imagePath ?? emptyProduct.imagePath,
    imageUrl: imagePreviewUrl ?? product?.imageUrl ?? null,
  };

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  // Warn before a reload or tab close would drop unsaved edits.
  useEffect(() => {
    if (!isDirty || saving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, saving]);

  function requestBack() {
    if (isDirty && !saving) {
      setConfirmDiscardOpen(true);
    } else {
      back();
    }
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0] ?? null;
    const pick = ++imagePickRef.current;
    setImageError(null);

    if (!file) {
      setImagePreparing(false);
      setImageFile(null);
      return;
    }

    // Both upload paths send the reduced photo; the size limit applies to it.
    setImagePreparing(true);
    const prepared = await downscaleProductImage(file);
    if (pick !== imagePickRef.current) {
      return;
    }
    setImagePreparing(false);

    const fileError = productImageFileError(prepared);
    if (fileError) {
      setImageFile(null);
      setImageError(fileError);
      input.value = "";
      return;
    }

    setImageFile(prepared);
  }

  async function submitMovement(
    reason: InventoryMovementReason,
    rawAmount: string,
    options?: { signed?: boolean; note?: string }
  ) {
    if (inventoryMovementSubmitting) {
      return;
    }
    if (!product) {
      return;
    }
    if (!product.tracksInventory) {
      setInventoryActionError(
        "Guardá el producto con inventario activado antes de ajustar stock."
      );
      return;
    }
    const amount = options?.signed
      ? parseSignedInteger(rawAmount)
      : parsePositiveInteger(rawAmount);
    if (amount == null) {
      setInventoryActionError(stockAmountError(rawAmount, options?.signed));
      return;
    }
    const delta =
      reason === "loss" || reason === "gift" ? -Math.abs(amount) : amount;
    setInventoryMovementSubmitting(true);
    try {
      await onInventoryMovement({
        productId: product.id,
        delta,
        reason,
        note: options?.note,
      });
      setInventoryActionError(null);
      if (reason === "restock") {
        setRestockAmount("");
      } else {
        setCorrectionAmount("");
        setCorrectionNote("");
      }
    } catch (error) {
      setInventoryActionError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el inventario."
      );
    } finally {
      setInventoryMovementSubmitting(false);
    }
  }

  async function handleSave() {
    const values = productForm.values;
    if (!values || !hasCategory || imagePreparing || pendingWrite != null) {
      return;
    }
    if (
      showInitialStockField &&
      initialStock.trim() &&
      parseNonNegativeInteger(initialStock) == null
    ) {
      setInventoryActionError(INITIAL_STOCK_ERROR);
      return;
    }
    await save({
      product: {
        ...values,
        // An edited product left on its category sends null, which keeps
        // it as stored (see ProductEditorSaveInput).
        categoryId:
          product && categoryId === initial.categoryId ? null : categoryId,
        imageTone,
        imagePath: product?.imagePath ?? null,
        tracksInventory,
      },
      imageFile,
      initialStock: showInitialStockField
        ? (parseNonNegativeInteger(initialStock) ?? undefined)
        : undefined,
    });
  }

  const correctionCopy = STOCK_CORRECTIONS[correction];

  return (
    <Screen
      width="medium"
      header={
        <ScreenHeader
          title={product ? "Editar producto" : "Nuevo producto"}
          onBack={requestBack}
        />
      }
      footer={
        <div className="flex items-center gap-3 md:justify-end">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="hidden md:inline-flex"
            onClick={requestBack}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={!canSave || imagePreparing || pendingWrite != null}
            className="flex-1 shadow-lg shadow-primary/20 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none md:min-w-56 md:flex-none"
            onClick={() => void handleSave()}
          >
            {pendingWrite === "save"
              ? "Guardando…"
              : pendingWrite === "busy"
                ? "Esperá…"
                : product
                  ? "Guardar cambios"
                  : "Agregar producto"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:items-start lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-10">
        {/* Image + placeholder tone */}
        <div className="md:sticky md:top-0">
          <p className="field-label">Imagen del producto</p>
          <div
            className={clsx(
              "image-uploader rounded-3xl",
              previewProduct.imageUrl && "has-image"
            )}
          >
            <ProductArt product={previewProduct} />
            <input
              ref={imageInputRef}
              className="sr-only"
              type="file"
              accept={productImageAccept}
              onChange={(event) => void handleImageChange(event)}
              aria-label="Elegir imagen del producto"
              tabIndex={-1}
            />
            <button
              type="button"
              className="image-upload-trigger rounded-2xl"
              onClick={() => imageInputRef.current?.click()}
            >
              <Camera size={32} aria-hidden />
              <strong>
                {previewProduct.imageUrl ? "Cambiar imagen" : "Subir imagen"}
              </strong>
              <span>Formatos {productImageFormatsLabel}</span>
            </button>
            <button
              type="button"
              className="edit-fab"
              aria-label="Cambiar imagen"
              onClick={() => imageInputRef.current?.click()}
            >
              <Edit3 size={19} aria-hidden />
            </button>
          </div>
          {imageError ? (
            <p className="mt-1.5 text-sm text-destructive" role="alert">
              {imageError}
            </p>
          ) : imagePreparing ? (
            <p className="mt-1.5 text-sm text-muted-foreground" role="status">
              Preparando la imagen…
            </p>
          ) : null}
          <p
            id={ids.toneLabel}
            className="mt-4 text-sm font-medium text-muted-foreground"
          >
            Color sin imagen
          </p>
          <div
            className="tone-picker"
            role="radiogroup"
            aria-labelledby={ids.toneLabel}
          >
            {placeholderImageTones.map((tone) => {
              const selected = imageTone === tone;
              return (
                <label key={tone} className="tone-option">
                  <input
                    type="radio"
                    name={ids.tone}
                    value={tone}
                    checked={selected}
                    onChange={() => setImageTone(tone)}
                    className="sr-only"
                  />
                  <span
                    className={clsx("tone-dot", tone, selected && "active")}
                    aria-hidden="true"
                  >
                    {selected ? <Check size={14} /> : null}
                  </span>
                  <span className="sr-only">
                    {placeholderImageToneLabels[tone]}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Details */}
        <div className="min-w-0">
          <FormField label="Nombre del producto">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej. Llaveros artesanales"
              maxLength={PRODUCT_NAME_MAX_LENGTH}
              aria-invalid={productForm.errors.name ? true : undefined}
              aria-describedby={
                productForm.errors.name ? ids.nameError : undefined
              }
            />
          </FormField>
          {productForm.errors.name ? (
            <p id={ids.nameError} className="mt-1.5 text-sm text-destructive">
              {productForm.errors.name}
            </p>
          ) : null}
          <div className="grid gap-x-3 sm:grid-cols-2">
            <div>
              <FormField label="Precio de venta">
                <MoneyInput
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="Ej. 15"
                  aria-invalid={productForm.errors.price ? true : undefined}
                  aria-describedby={
                    productForm.errors.price ? ids.priceError : undefined
                  }
                />
              </FormField>
              {productForm.errors.price ? (
                <p
                  id={ids.priceError}
                  className="mt-1.5 text-sm text-destructive"
                >
                  {productForm.errors.price}
                </p>
              ) : null}
            </div>
            <div>
              <FormField label="Costo unitario" hint="Opcional">
                <MoneyInput
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="Desconocido"
                  aria-invalid={productForm.errors.cost ? true : undefined}
                  aria-describedby={
                    productForm.errors.cost ? ids.costError : undefined
                  }
                />
              </FormField>
              {productForm.errors.cost ? (
                <p
                  id={ids.costError}
                  className="mt-1.5 text-sm text-destructive"
                >
                  {productForm.errors.cost}
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            El costo se usa para calcular ganancias. Si queda vacío, se marca
            como desconocido.
          </p>

          <div className="mt-5 grid gap-2">
            <p id={ids.category} className="text-sm font-medium">
              Categoría
            </p>
            <CategoryPicker
              value={categoryId}
              onChange={setCategoryId}
              categories={categories}
              currentCategory={currentCategory}
              onCreate={() => setCategoryDrawerOpen(true)}
              labelledBy={ids.category}
            />
            {!hasCategory ? (
              <p className="text-sm text-muted-foreground">
                Elegí o creá una categoría para poder guardar el producto.
              </p>
            ) : null}
          </div>

          <section className="mt-6 rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
            <Label className="flex items-start justify-between gap-3">
              <span>
                <strong className="block text-[15px] font-semibold">
                  Controlar inventario
                </strong>
                <small className="mt-1 block text-sm leading-snug font-normal text-muted-foreground">
                  Cuenta unidades disponibles; nunca bloquea una venta.
                </small>
              </span>
              <Switch
                checked={tracksInventory}
                onCheckedChange={setTracksInventory}
                className="mt-0.5"
              />
            </Label>

            {showInitialStockField ? (
              <>
                <FormField label="Stock inicial">
                  <Input
                    value={initialStock}
                    onChange={(event) => {
                      setInitialStock(event.target.value);
                      setInventoryActionError(null);
                    }}
                    inputMode="numeric"
                    placeholder="Ej. 10"
                  />
                </FormField>
                {/* The count is a baseline: earlier sales are not subtracted. */}
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {initialStockHint({
                    wasTrackingInventory: trackingPersisted,
                    initialMovement,
                  })}
                </p>
              </>
            ) : null}

            {trackingDirty ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Guardá los cambios para activar los ajustes de inventario.
              </p>
            ) : null}

            {product && trackingPersisted ? (
              <div className="mt-4 grid gap-4">
                {currentStock != null ? (
                  <p className="text-sm text-muted-foreground">
                    En mano:{" "}
                    <strong className="text-foreground">
                      {stockValueLabel(currentStock)}
                    </strong>
                  </p>
                ) : null}

                <div>
                  <Label
                    htmlFor={ids.restock}
                    className="mb-1.5 block text-sm font-semibold text-muted-foreground"
                  >
                    Reponer stock
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id={ids.restock}
                      value={restockAmount}
                      onChange={(event) => setRestockAmount(event.target.value)}
                      inputMode="numeric"
                      placeholder="Ej. +5"
                      aria-invalid={restockError ? true : undefined}
                      aria-describedby={
                        restockError ? ids.restockError : undefined
                      }
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!canRestock || inventoryMovementSubmitting}
                      aria-label="Registrar reposición"
                      onClick={() =>
                        void submitMovement("restock", restockAmount)
                      }
                    >
                      <Plus />
                    </Button>
                  </div>
                  {restockError ? (
                    <p
                      id={ids.restockError}
                      className="mt-1.5 text-sm text-destructive"
                    >
                      {restockError}
                    </p>
                  ) : null}
                </div>

                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="justify-start px-0"
                  aria-expanded={showMoreActions}
                  onClick={() => setShowMoreActions((value) => !value)}
                >
                  {showMoreActions
                    ? "Ocultar correcciones"
                    : "Ajuste, pérdida o regalo"}
                </Button>

                {showMoreActions ? (
                  <div className="grid gap-2.5">
                    <SegmentedControl<StockCorrection>
                      aria-label="Tipo de corrección"
                      size="sm"
                      value={correction}
                      onChange={(next) => {
                        setCorrection(next);
                        setInventoryActionError(null);
                      }}
                      options={(
                        Object.keys(STOCK_CORRECTIONS) as StockCorrection[]
                      ).map((value) => ({
                        value,
                        label: STOCK_CORRECTIONS[value].label,
                      }))}
                    />
                    <p className="text-sm text-muted-foreground">
                      {correctionCopy.hint}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                      <Input
                        value={correctionAmount}
                        onChange={(event) =>
                          setCorrectionAmount(event.target.value)
                        }
                        inputMode={
                          correction === "adjustment" ? "text" : "numeric"
                        }
                        placeholder={correctionCopy.placeholder}
                        aria-label={`Unidades (${correctionCopy.label.toLowerCase()})`}
                        aria-invalid={correctionError ? true : undefined}
                        aria-describedby={
                          correctionError ? ids.correctionError : undefined
                        }
                      />
                      <Input
                        value={correctionNote}
                        onChange={(event) =>
                          setCorrectionNote(event.target.value)
                        }
                        placeholder="Nota (opcional)"
                        aria-label="Nota de la corrección"
                        maxLength={MAX_NOTE_LENGTH}
                      />
                    </div>
                    {correctionError ? (
                      <p
                        id={ids.correctionError}
                        className="text-sm text-destructive"
                      >
                        {correctionError}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canCorrect || inventoryMovementSubmitting}
                      onClick={() =>
                        void submitMovement(correction, correctionAmount, {
                          signed: correction === "adjustment",
                          note: correctionNote,
                        })
                      }
                    >
                      {correctionCopy.action}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {inventoryActionError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {inventoryActionError}
              </p>
            ) : null}
          </section>

          {product ? (
            <section className="mt-6 flex flex-col gap-3 rounded-3xl border border-destructive/25 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong className="block text-[15px] font-semibold">
                  Archivar producto
                </strong>
                <span className="text-sm text-muted-foreground">
                  Deja de aparecer en Vender. Las ventas pasadas se conservan.
                </span>
              </div>
              <Button
                type="button"
                variant="destructive"
                className="shrink-0"
                disabled={pendingWrite != null}
                onClick={() => setConfirmArchiveOpen(true)}
              >
                <Archive className="size-4" />
                {pendingWrite === "archive" ? "Archivando…" : "Archivar"}
              </Button>
            </section>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        icon={<TriangleAlert className="size-5" />}
        tone="destructive"
        title="¿Descartar los cambios?"
        description="Los cambios de este producto no se guardaron."
        cancelLabel="Seguir editando"
        confirmLabel="Descartar"
        onConfirm={back}
      />
      <CategoryFormDrawer
        open={categoryDrawerOpen}
        existingNames={categories.map((item) => item.name)}
        onOpenChange={setCategoryDrawerOpen}
        onSave={async (categoryName) => {
          const created = await createCategory(categoryName);
          if (created) {
            setCategoryId(created.id);
          }
        }}
      />
      {product ? (
        <ConfirmDialog
          open={confirmArchiveOpen}
          onOpenChange={setConfirmArchiveOpen}
          icon={<Archive className="size-5" />}
          tone="destructive"
          title={`¿Archivar “${product.name}”?`}
          description="Deja de aparecer en Vender. Podés restaurarlo desde Catálogo › Archivados."
          confirmLabel="Archivar"
          onConfirm={() => void archive(product.id)}
        />
      ) : null}
    </Screen>
  );
}
