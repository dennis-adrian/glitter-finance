"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArchiveRestore,
  Camera,
  Check,
  ChevronLeft,
  Edit3,
  Minus,
  Plus,
} from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { FormField } from "@/components/atoms/form-field";
import { Header } from "@/components/atoms/header";
import { ProductArt } from "@/components/atoms/product-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  getProductStock,
  stockValueLabel,
  type InventoryMovementReason,
} from "@/lib/inventory";
import {
  defaultPlaceholderImageTone,
  placeholderImageTones,
  productImageAccept,
  productImageFileError,
  productImageFormatsLabel,
} from "@/lib/product-image-config";
import { downscaleProductImage } from "@/lib/product-image-downscale";
import { emptyProduct, PRODUCT_NAME_MAX_LENGTH } from "@/lib/products";
import { canonicalizeCategory, categories } from "@/lib/categories";
import type { Product } from "@/lib/types";
import { MAX_NOTE_LENGTH } from "@/lib/validation";
import {
  INITIAL_STOCK_ERROR,
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseSignedInteger,
  stockAmountError,
  validateProductForm,
} from "@/components/screens/product-editor.helpers";

type ProductEditorProps = {
  product: Product | null;
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  hasInitialMovement: boolean;
  back: () => void;
  save: (input: {
    name: string;
    priceCents: number;
    costCents: number | null;
    category: string;
    imageTone: string;
    imagePath?: string | null;
    imageFile?: File | null;
    tracksInventory: boolean;
    initialStock?: number;
  }) => Promise<void> | void;
  onInventoryMovement: (input: {
    productId: string;
    delta: number;
    reason: InventoryMovementReason;
    note?: string;
  }) => Promise<void> | void;
  archive: (productId: string) => void;
};

export function ProductEditor({
  product,
  stockByProduct,
  inventoryStockReady,
  hasInitialMovement,
  back,
  save,
  onInventoryMovement,
  archive,
}: ProductEditorProps) {
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(
    product ? String(product.priceCents / 100) : ""
  );
  const [cost, setCost] = useState(
    product?.costCents == null ? "" : String(product.costCents / 100)
  );
  const [category, setCategory] = useState(
    canonicalizeCategory(product?.category ?? "Stickers")
  );
  const [imageTone, setImageTone] = useState(
    product?.imageTone ?? defaultPlaceholderImageTone
  );
  const [tracksInventory, setTracksInventory] = useState(
    product?.tracksInventory ?? false
  );
  const [initialStock, setInitialStock] = useState("");
  const [restockAmount, setRestockAmount] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [lossAmount, setLossAmount] = useState("");
  const [lossNote, setLossNote] = useState("");
  const [giftAmount, setGiftAmount] = useState("");
  const [giftNote, setGiftNote] = useState("");
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Counts picks, so a slow reduction of an earlier photo cannot replace a
  // later one.
  const imagePickRef = useRef(0);
  const productForm = validateProductForm({ name, price, cost });
  const canSave = productForm.values != null;
  const trackingPersisted = product?.tracksInventory ?? false;
  const trackingDirty =
    Boolean(product) && tracksInventory !== trackingPersisted;
  const showInitialStockField =
    tracksInventory && (!product || !hasInitialMovement);
  const currentStock =
    product && trackingPersisted && inventoryStockReady
      ? getProductStock(product, stockByProduct)
      : null;
  const canRestock = parsePositiveInteger(restockAmount) != null;
  const canAdjust = parseSignedInteger(adjustmentAmount) != null;
  const canLoss = parsePositiveInteger(lossAmount) != null;
  const canGift = parsePositiveInteger(giftAmount) != null;
  const restockError = stockAmountError(restockAmount);
  const adjustmentError = stockAmountError(adjustmentAmount, true);
  const lossError = stockAmountError(lossAmount);
  const giftError = stockAmountError(giftAmount);
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
        "Guarda el producto con inventario activado antes de ajustar stock."
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
      }
      if (reason === "adjustment") {
        setAdjustmentAmount("");
        setAdjustmentNote("");
      }
      if (reason === "loss") {
        setLossAmount("");
        setLossNote("");
      }
      if (reason === "gift") {
        setGiftAmount("");
        setGiftNote("");
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

  return (
    <section className="screen editor-screen">
      <Header
        title={product ? "Editar producto" : "Nuevo producto"}
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={back}
            aria-label="Volver"
          >
            <ChevronLeft className="size-6" />
          </Button>
        }
        right={<BrandMark size="small" />}
      />

      {/* Bespoke image uploader + tone picker keep their existing styles since
          they're coupled to ProductArt's gradient placeholders. */}
      <label className="field-label">Imagen del producto</label>
      <div
        className={clsx(
          "image-uploader",
          previewProduct.imageUrl && "has-image"
        )}
      >
        <ProductArt product={previewProduct} />
        <input
          ref={imageInputRef}
          className="sr-only"
          type="file"
          accept={productImageAccept}
          onChange={handleImageChange}
        />
        <button
          type="button"
          className="image-upload-trigger"
          onClick={() => imageInputRef.current?.click()}
        >
          <Camera size={32} />
          <strong>
            {previewProduct.imageUrl ? "Cambiar imagen" : "Subir imagen"}
          </strong>
          <span>Formatos {productImageFormatsLabel}</span>
        </button>
        <button
          type="button"
          className="edit-fab"
          aria-label="Editar imagen"
          onClick={() => imageInputRef.current?.click()}
        >
          <Edit3 size={19} />
        </button>
      </div>
      {imageError ? (
        <p className="mt-1.5 text-sm text-destructive">{imageError}</p>
      ) : imagePreparing ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          Preparando la imagen…
        </p>
      ) : null}
      <div className="tone-picker" aria-label="Color del marcador de posición">
        {placeholderImageTones.map((tone) => (
          <button
            key={tone}
            className={clsx("tone-dot", tone, imageTone === tone && "active")}
            onClick={() => setImageTone(tone)}
          >
            {imageTone === tone ? <Check size={14} /> : null}
          </button>
        ))}
      </div>

      <FormField label="Nombre del producto">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ej. Llaveros artesanales"
          maxLength={PRODUCT_NAME_MAX_LENGTH}
          aria-invalid={productForm.errors.name ? true : undefined}
          className="h-12 rounded-xl"
        />
      </FormField>
      {productForm.errors.name ? (
        <p className="mt-1.5 text-sm text-destructive">
          {productForm.errors.name}
        </p>
      ) : null}
      <FormField label="Precio de venta">
        <Input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          inputMode="decimal"
          placeholder="15"
          aria-invalid={productForm.errors.price ? true : undefined}
          className="h-12 rounded-xl"
        />
      </FormField>
      {productForm.errors.price ? (
        <p className="mt-1.5 text-sm text-destructive">
          {productForm.errors.price}
        </p>
      ) : null}
      <FormField label="Costo unitario" hint="Opcional">
        <Input
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          inputMode="decimal"
          placeholder="Desconocido"
          aria-invalid={productForm.errors.cost ? true : undefined}
          className="h-12 rounded-xl"
        />
      </FormField>
      {productForm.errors.cost ? (
        <p className="mt-1.5 text-sm text-destructive">
          {productForm.errors.cost}
        </p>
      ) : null}
      <p className="mt-1.5 text-sm text-muted-foreground">
        Se usa para calcular ganancias. Si queda vacío, el costo se marca como
        desconocido.
      </p>
      <FormField label="Categoría" id="product-category">
        <Select
          value={category}
          onValueChange={(value) => setCategory(value ?? "")}
        >
          <SelectTrigger
            id="product-category"
            className="h-12 w-full rounded-xl"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories
              .filter((item) => item !== "Todos")
              .map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </FormField>

      <section className="mt-5 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <Label className="flex items-start justify-between gap-3">
          <span>
            <strong className="block text-[15px] font-semibold">
              Rastrear inventario
            </strong>
            <small className="mt-1 block text-sm leading-snug text-muted-foreground">
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
                placeholder="10"
                className="h-12 rounded-xl"
              />
            </FormField>
            {/* The count is a baseline: earlier sales are not subtracted. */}
            <p className="mt-1.5 text-sm text-muted-foreground">
              {trackingPersisted
                ? "Unidades que tienes ahora."
                : "Unidades que tienes ahora. Si lo dejas vacío, empieza en 0."}
            </p>
          </>
        ) : null}

        {trackingDirty ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Guarda los cambios para activar los ajustes de inventario.
          </p>
        ) : null}

        {product && trackingPersisted ? (
          <div className="mt-4 grid gap-3">
            {currentStock != null ? (
              <p className="text-sm text-muted-foreground">
                En mano:{" "}
                <strong className="text-foreground">
                  {stockValueLabel(currentStock)}
                </strong>
              </p>
            ) : null}

            <div>
              <Label className="mb-1.5 block text-sm font-semibold text-muted-foreground">
                Reabastecer
              </Label>
              <div className="flex gap-2">
                <Input
                  value={restockAmount}
                  onChange={(event) => setRestockAmount(event.target.value)}
                  inputMode="numeric"
                  placeholder="+5"
                  aria-invalid={restockError ? true : undefined}
                  className="h-14 flex-1 rounded-xl"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  disabled={!canRestock || inventoryMovementSubmitting}
                  aria-label="Registrar reabastecimiento"
                  onClick={() => void submitMovement("restock", restockAmount)}
                >
                  <Plus />
                </Button>
              </div>
              {restockError ? (
                <p className="mt-1.5 text-sm text-destructive">
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
              {showMoreActions ? "Menos acciones" : "Más acciones"}
            </Button>

            {showMoreActions ? (
              <>
                <div>
                  <Label className="mb-1.5 block text-sm font-semibold text-muted-foreground">
                    Ajuste
                  </Label>
                  <div className="flex flex-col gap-2">
                    <Input
                      value={adjustmentAmount}
                      onChange={(event) =>
                        setAdjustmentAmount(event.target.value)
                      }
                      placeholder="±2"
                      aria-invalid={adjustmentError ? true : undefined}
                      className="h-14 rounded-xl"
                    />
                    {adjustmentError ? (
                      <p className="text-sm text-destructive">
                        {adjustmentError}
                      </p>
                    ) : null}
                    <Input
                      value={adjustmentNote}
                      onChange={(event) =>
                        setAdjustmentNote(event.target.value)
                      }
                      placeholder="Nota opcional"
                      maxLength={MAX_NOTE_LENGTH}
                      className="h-14 rounded-xl"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={!canAdjust || inventoryMovementSubmitting}
                      onClick={() =>
                        void submitMovement("adjustment", adjustmentAmount, {
                          signed: true,
                          note: adjustmentNote,
                        })
                      }
                    >
                      Ajustar
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="mb-1.5 block text-sm font-semibold text-muted-foreground">
                    Pérdida
                  </Label>
                  <div className="flex flex-col gap-2">
                    <Input
                      value={lossAmount}
                      onChange={(event) => setLossAmount(event.target.value)}
                      inputMode="numeric"
                      placeholder="2"
                      aria-invalid={lossError ? true : undefined}
                      className="h-14 rounded-xl"
                    />
                    {lossError ? (
                      <p className="text-sm text-destructive">{lossError}</p>
                    ) : null}
                    <Input
                      value={lossNote}
                      onChange={(event) => setLossNote(event.target.value)}
                      placeholder="Nota opcional"
                      maxLength={MAX_NOTE_LENGTH}
                      className="h-14 rounded-xl"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={!canLoss || inventoryMovementSubmitting}
                      aria-label="Registrar pérdida"
                      onClick={() =>
                        void submitMovement("loss", lossAmount, {
                          note: lossNote,
                        })
                      }
                    >
                      <Minus />
                      Registrar pérdida
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="mb-1.5 block text-sm font-semibold text-muted-foreground">
                    Regalo
                  </Label>
                  <div className="flex flex-col gap-2">
                    <Input
                      value={giftAmount}
                      onChange={(event) => setGiftAmount(event.target.value)}
                      inputMode="numeric"
                      placeholder="1"
                      aria-invalid={giftError ? true : undefined}
                      className="h-14 rounded-xl"
                    />
                    {giftError ? (
                      <p className="text-sm text-destructive">{giftError}</p>
                    ) : null}
                    <Input
                      value={giftNote}
                      onChange={(event) => setGiftNote(event.target.value)}
                      placeholder="Nota opcional"
                      maxLength={MAX_NOTE_LENGTH}
                      className="h-14 rounded-xl"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={!canGift || inventoryMovementSubmitting}
                      aria-label="Registrar regalo"
                      onClick={() =>
                        void submitMovement("gift", giftAmount, {
                          note: giftNote,
                        })
                      }
                    >
                      <Minus />
                      Registrar regalo
                    </Button>
                  </div>
                </div>
              </>
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
        <Button
          type="button"
          variant="ghost"
          onClick={() => archive(product.id)}
          className="mt-6 mb-20 h-auto w-full flex-col gap-1 py-4 text-destructive hover:text-destructive"
        >
          <span className="flex items-center gap-2 font-bold">
            <ArchiveRestore className="size-[18px]" />
            Archivar producto
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            El producto ya no aparecerá en el menú de ventas.
          </span>
        </Button>
      ) : null}
      <Button
        size="lg"
        disabled={!canSave || imagePreparing}
        className="sticky bottom-0 mt-4 w-full font-extrabold tracking-wide shadow-lg shadow-primary/25 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
        onClick={() => {
          const values = productForm.values;
          if (!values) {
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
          save({
            ...values,
            category,
            imageTone,
            imagePath: product?.imagePath ?? null,
            imageFile,
            tracksInventory,
            initialStock: showInitialStockField
              ? (parseNonNegativeInteger(initialStock) ?? undefined)
              : undefined,
          });
        }}
      >
        GUARDAR CAMBIOS
      </Button>
    </section>
  );
}
