"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArchiveRestore,
  Camera,
  Check,
  ChevronRight,
  Edit3,
  Minus,
  Plus,
} from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { FormField } from "@/components/atoms/form-field";
import { Header } from "@/components/atoms/header";
import { ProductArt } from "@/components/atoms/product-art";
import {
  getProductStock,
  stockValueLabel,
  type InventoryMovementReason,
} from "@/lib/inventory";
import { parseBolivianos } from "@/lib/money";
import {
  productImageMaxBytes,
  productImageMimeTypes,
} from "@/lib/product-image-config";
import { emptyProduct } from "@/lib/products";
import { categories } from "@/lib/sample-data";
import type { Product } from "@/lib/types";
import { hasValidProductForm, parsePositiveInteger, parseSignedInteger } from "@/components/screens/product-editor.helpers";

type ProductEditorProps = {
  product: Product | null;
  stockByProduct: Map<string, number>;
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
  const [category, setCategory] = useState(product?.category ?? "Stickers");
  const [imageTone, setImageTone] = useState(product?.imageTone ?? "violet");
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
  const [inventoryActionError, setInventoryActionError] = useState<
    string | null
  >(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const canSave = hasValidProductForm(name, price);
  const showInitialStockField =
    tracksInventory && (!product || !hasInitialMovement);
  const currentStock = product
    ? getProductStock(product, stockByProduct)
    : null;
  const canRestock = parsePositiveInteger(restockAmount) != null;
  const canAdjust = parseSignedInteger(adjustmentAmount) != null;
  const canLoss = parsePositiveInteger(lossAmount) != null;
  const canGift = parsePositiveInteger(giftAmount) != null;
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

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImageError(null);

    if (!file) {
      setImageFile(null);
      return;
    }

    if (!productImageMimeTypes.some((type) => type === file.type)) {
      setImageFile(null);
      setImageError("La imagen debe estar en formato JPG o PNG.");
      event.target.value = "";
      return;
    }

    if (file.size > productImageMaxBytes) {
      setImageFile(null);
      setImageError("La imagen no puede superar 5MB.");
      event.target.value = "";
      return;
    }

    setImageFile(file);
  }

  async function submitMovement(
    reason: InventoryMovementReason,
    rawAmount: string,
    options?: { signed?: boolean; note?: string }
  ) {
    if (!product) {
      return;
    }
    const amount = options?.signed
      ? parseSignedInteger(rawAmount)
      : parsePositiveInteger(rawAmount);
    if (amount == null) {
      if (rawAmount.trim()) {
        setInventoryActionError(
          "Usa un número entero sin decimales ni texto extra."
        );
      }
      return;
    }
    setInventoryActionError(null);
    const delta =
      reason === "loss" || reason === "gift" ? -Math.abs(amount) : amount;
    await onInventoryMovement({
      productId: product.id,
      delta,
      reason,
      note: options?.note,
    });
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
  }

  return (
    <section className="screen editor-screen">
      <Header
        title={product ? "Editar producto" : "Nuevo producto"}
        left={
          <button className="icon-button" onClick={back} aria-label="Volver">
            <ChevronRight className="flip dark" size={24} />
          </button>
        }
        right={<BrandMark size="small" />}
      />
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
          accept="image/jpeg,image/png"
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
          <span>Formatos JPG, PNG (Max 5MB)</span>
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
      {imageError ? <p className="field-help error">{imageError}</p> : null}
      <div className="tone-picker" aria-label="Color de placeholder">
        {["aurora", "coral", "linen", "violet", "warm"].map((tone) => (
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
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Mascot Sticker"
        />
      </FormField>
      <FormField label="Precio de venta">
        <input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          inputMode="decimal"
          placeholder="15"
        />
      </FormField>
      <FormField label="Costo unitario" hint="Opcional">
        <input
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          inputMode="decimal"
          placeholder="Desconocido"
        />
      </FormField>
      <p className="field-help">
        Se usa para calcular ganancias. Si queda vacío, el costo se marca como
        desconocido.
      </p>
      <FormField label="Categoría">
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories
            .filter((item) => item !== "Todos")
            .map((item) => (
              <option key={item}>{item}</option>
            ))}
        </select>
      </FormField>

      <section className="inventory-panel">
        <label className="inventory-toggle">
          <span>
            <strong>Rastrear inventario</strong>
            <small>Cuenta unidades disponibles; nunca bloquea una venta.</small>
          </span>
          <input
            type="checkbox"
            checked={tracksInventory}
            onChange={(event) => setTracksInventory(event.target.checked)}
          />
        </label>

        {showInitialStockField ? (
          <FormField label="Stock inicial">
            <input
              value={initialStock}
              onChange={(event) => {
                setInitialStock(event.target.value);
                setInventoryActionError(null);
              }}
              inputMode="numeric"
              placeholder="10"
            />
          </FormField>
        ) : null}

        {product && tracksInventory ? (
          <div className="inventory-actions">
            {currentStock ? (
              <p className="inventory-current">
                En mano: <strong>{stockValueLabel(currentStock)}</strong>
              </p>
            ) : null}

            <div className="inventory-action-row">
              <label>Reabastecer</label>
              <div className="inventory-action-controls">
                <input
                  value={restockAmount}
                  onChange={(event) => setRestockAmount(event.target.value)}
                  inputMode="numeric"
                  placeholder="+5"
                />
                <button
                  type="button"
                  className="inventory-action-button"
                  disabled={!canRestock}
                  onClick={() =>
                    void submitMovement("restock", restockAmount)
                  }
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <button
              type="button"
              className="inventory-more-toggle"
              aria-expanded={showMoreActions}
              onClick={() => setShowMoreActions((value) => !value)}
            >
              {showMoreActions ? "Menos acciones" : "Más acciones"}
            </button>

            {showMoreActions ? (
              <>
                <div className="inventory-action-row">
                  <label>Ajuste</label>
                  <div className="inventory-action-controls stacked">
                    <input
                      value={adjustmentAmount}
                      onChange={(event) =>
                        setAdjustmentAmount(event.target.value)
                      }
                      inputMode="numeric"
                      placeholder="±2"
                    />
                    <input
                      value={adjustmentNote}
                      onChange={(event) =>
                        setAdjustmentNote(event.target.value)
                      }
                      placeholder="Nota opcional"
                    />
                    <button
                      type="button"
                      className="inventory-action-button"
                      disabled={!canAdjust}
                      onClick={() =>
                        void submitMovement("adjustment", adjustmentAmount, {
                          signed: true,
                          note: adjustmentNote,
                        })
                      }
                    >
                      Ajustar
                    </button>
                  </div>
                </div>

                <div className="inventory-action-row">
                  <label>Pérdida</label>
                  <div className="inventory-action-controls stacked">
                    <input
                      value={lossAmount}
                      onChange={(event) => setLossAmount(event.target.value)}
                      inputMode="numeric"
                      placeholder="2"
                    />
                    <input
                      value={lossNote}
                      onChange={(event) => setLossNote(event.target.value)}
                      placeholder="Nota opcional"
                    />
                    <button
                      type="button"
                      className="inventory-action-button"
                      disabled={!canLoss}
                      onClick={() =>
                        void submitMovement("loss", lossAmount, {
                          note: lossNote,
                        })
                      }
                    >
                      <Minus size={16} />
                    </button>
                  </div>
                </div>

                <div className="inventory-action-row">
                  <label>Regalo</label>
                  <div className="inventory-action-controls stacked">
                    <input
                      value={giftAmount}
                      onChange={(event) => setGiftAmount(event.target.value)}
                      inputMode="numeric"
                      placeholder="1"
                    />
                    <input
                      value={giftNote}
                      onChange={(event) => setGiftNote(event.target.value)}
                      placeholder="Nota opcional"
                    />
                    <button
                      type="button"
                      className="inventory-action-button"
                      disabled={!canGift}
                      onClick={() =>
                        void submitMovement("gift", giftAmount, {
                          note: giftNote,
                        })
                      }
                    >
                      <Minus size={16} />
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        {inventoryActionError ? (
          <p className="field-help error">{inventoryActionError}</p>
        ) : null}
      </section>

      {product ? (
        <button className="archive-button" onClick={() => archive(product.id)}>
          <ArchiveRestore size={18} />
          Archivar producto
          <span>El producto ya no aparecerá en el menú de ventas.</span>
        </button>
      ) : null}
      <button
        className="save-dock"
        disabled={!canSave}
        onClick={() => {
          if (
            showInitialStockField &&
            initialStock.trim() &&
            parsePositiveInteger(initialStock) == null
          ) {
            setInventoryActionError(
              "El stock inicial debe ser un número entero sin decimales."
            );
            return;
          }
          save({
            name: name.trim(),
            priceCents: parseBolivianos(price),
            costCents: cost.trim() ? parseBolivianos(cost) : null,
            category,
            imageTone,
            imagePath: product?.imagePath ?? null,
            imageFile,
            tracksInventory,
            initialStock: showInitialStockField
              ? parsePositiveInteger(initialStock) ?? undefined
              : undefined,
          });
        }}
      >
        GUARDAR CAMBIOS
      </button>
    </section>
  );
}
