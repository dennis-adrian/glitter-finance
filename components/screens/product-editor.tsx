"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArchiveRestore,
  Camera,
  Check,
  ChevronRight,
  Edit3,
} from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { FormField } from "@/components/atoms/form-field";
import { Header } from "@/components/atoms/header";
import { ProductArt } from "@/components/atoms/product-art";
import { parseBolivianos } from "@/lib/money";
import {
  productImageMaxBytes,
  productImageMimeTypes,
} from "@/lib/product-image-config";
import { emptyProduct } from "@/lib/products";
import { categories } from "@/lib/sample-data";
import type { Product } from "@/lib/types";
import { hasValidProductForm } from "@/components/screens/product-editor.helpers";

type ProductEditorProps = {
  product: Product | null;
  back: () => void;
  save: (input: {
    name: string;
    priceCents: number;
    costCents: number | null;
    category: string;
    imageTone: string;
    imagePath?: string | null;
    imageFile?: File | null;
  }) => Promise<void> | void;
  archive: (productId: string) => void;
};

export function ProductEditor({
  product,
  back,
  save,
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const canSave = hasValidProductForm(name, price);
  const previewProduct = {
    ...(product ?? emptyProduct),
    name: name || "Producto",
    imageTone,
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
        onClick={() =>
          save({
            name: name.trim(),
            priceCents: parseBolivianos(price),
            costCents: cost.trim() ? parseBolivianos(cost) : null,
            category,
            imageTone,
            imagePath: product?.imagePath ?? null,
            imageFile,
          })
        }
      >
        GUARDAR CAMBIOS
      </button>
    </section>
  );
}
