"use client";

import { useState } from "react";
import { Check, ReceiptText, Share2 } from "lucide-react";
import { Screen } from "@/components/templates/screen";
import { Button } from "@/components/ui/button";
import { formatBs } from "@/lib/money";
import { countLabel } from "@/lib/plural";
import { buildReceiptText, type CompletedSaleSummary } from "@/lib/receipt";
import { paymentLabels } from "@/lib/sales";

type SaleCompleteScreenProps = {
  sale: CompletedSaleSummary;
  storeName?: string | null;
  newSale: () => void;
  openSale: (saleId: string) => void;
  notify: (text: string, tone?: "success" | "info" | "danger") => void;
};

/** Confirmation after a sale is recorded: amount, change due, next steps. */
export function SaleCompleteScreen({
  sale,
  storeName,
  newSale,
  openSale,
  notify,
}: SaleCompleteScreenProps) {
  const [sharing, setSharing] = useState(false);
  const hasChange = sale.paymentMethod === "cash" && Boolean(sale.changeCents);

  async function shareReceipt() {
    const text = buildReceiptText(sale, storeName);
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Recibo", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      notify("Recibo copiado. Pegalo en WhatsApp o donde quieras.", "info");
    } catch (error) {
      // Closing the share sheet rejects with AbortError: not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify("No se pudo compartir el recibo.", "danger");
    } finally {
      setSharing(false);
    }
  }

  return (
    <Screen width="narrow" bodyClassName="flex min-h-full flex-col">
      <div className="my-auto flex flex-col items-center py-8 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-primary/12 text-primary">
          <Check className="size-10" strokeWidth={2.5} aria-hidden />
        </span>
        <h1 className="mt-5 font-heading text-2xl font-extrabold">
          Venta registrada
        </h1>
        <strong className="mt-2 font-heading text-5xl leading-none font-extrabold text-primary tabular-nums">
          {formatBs(sale.totalCents, true)}
        </strong>
        <p className="mt-3 text-sm text-muted-foreground">
          {paymentLabels[sale.paymentMethod]} ·{" "}
          {countLabel(sale.itemCount, "producto", "productos")}
          {sale.discountCents
            ? ` · −${formatBs(sale.discountCents, true)} de descuento`
            : ""}
        </p>

        {hasChange ? (
          <div
            className="mt-6 w-full max-w-sm rounded-3xl bg-primary/10 px-5 py-4 text-primary"
            role="status"
          >
            <span className="block text-sm font-semibold">
              Cambio a entregar
            </span>
            <strong className="mt-1 block font-heading text-4xl font-extrabold tabular-nums">
              {formatBs(sale.changeCents ?? 0, true)}
            </strong>
            <span className="mt-1 block text-xs text-primary/80">
              Recibido: {formatBs(sale.receivedCents ?? 0, true)}
            </span>
          </div>
        ) : null}

        <div className="mt-8 grid w-full max-w-sm gap-2.5">
          <Button size="lg" onClick={newSale} autoFocus>
            Nueva venta
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => void shareReceipt()}
            disabled={sharing}
          >
            <Share2 className="size-4.5" />
            Compartir recibo
          </Button>
          {sale.saleId ? (
            <Button
              variant="ghost"
              className="text-primary hover:text-primary"
              onClick={() => openSale(sale.saleId!)}
            >
              <ReceiptText className="size-4.5" />
              Ver detalle de la venta
            </Button>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}
