"use client";

import { useMemo, useState } from "react";
import { Download, Share } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SalesRangeBounds } from "@/lib/dates";
import { countLabel } from "@/lib/plural";
import { saveFile, shareFile, type SaveFileOutcome } from "@/lib/save-file";
import {
  buildSalesCsvChunks,
  countExportedSales,
  refundedSaleIdsOf,
  SALES_CSV_MIME_TYPE,
  salesCsvFilename,
} from "@/lib/sales-export";
import type { Sale } from "@/lib/types";

type ExportSalesButtonProps = {
  /** The sales of the range Reports shows, as it computes them. */
  sales: Sale[];
  /** Every loaded sale, to mark the range's sales refunded after it. */
  allSales: Sale[];
  /** Null while the custom range is invalid. */
  bounds: SalesRangeBounds | null;
  tenantName: string;
  /**
   * Why the loaded sales do not cover the range (before a PowerSync
   * device's first sync), or null when they do. The file would be missing
   * sales, so it is not made.
   */
  incompleteReason: string | null;
};

type ExportState =
  | { status: "idle" }
  | { status: "building" }
  /** Built, waiting for a tap to share it (see SaveFileOutcome). */
  | { status: "ready"; file: File; sales: Sale[] };

/**
 * Exports the range's sales as CSV (lib/sales-export.ts), built from the
 * sales already on screen, so it works offline and without PowerSync alike.
 */
export function ExportSalesButton({
  sales,
  allSales,
  bounds,
  tenantName,
  incompleteReason,
}: ExportSalesButtonProps) {
  const [state, setState] = useState<ExportState>({ status: "idle" });
  // A file built for other sales (the range or the data changed) is stale.
  const readyFile =
    state.status === "ready" && state.sales === sales ? state.file : null;
  const { saleCount, refundCount } = countExportedSales(sales);
  const refundedSaleIds = useMemo(
    () => refundedSaleIdsOf(allSales),
    [allSales]
  );

  function finish(outcome: SaveFileOutcome, file: File, forSales: Sale[]) {
    if (outcome === "needs-tap") {
      // The button turns into "Compartir CSV" (a toast would cover it on a
      // phone, where toasts show at the top).
      setState({ status: "ready", file, sales: forSales });
      return;
    }
    setState({ status: "idle" });
    if (outcome !== "cancelled") {
      const counted = [
        countLabel(saleCount, "venta", "ventas"),
        ...(refundCount
          ? [countLabel(refundCount, "reembolso", "reembolsos")]
          : []),
      ].join(" y ");
      toast.success(`Exportaste ${counted} a ${file.name}.`);
    }
  }

  function fail(error: unknown) {
    console.error("[export] sales CSV failed", error);
    setState({ status: "idle" });
    toast.error("No se pudo exportar el archivo. Probá de nuevo.");
  }

  async function handleExport() {
    if (!bounds) {
      toast.error("Elegí un período válido para exportar.");
      return;
    }
    if (incompleteReason) {
      toast.error(incompleteReason);
      return;
    }
    if (!saleCount && !refundCount) {
      toast("No hay ventas para exportar en este período.");
      return;
    }

    const forSales = sales;
    setState({ status: "building" });
    try {
      const chunks = await buildSalesCsvChunks(forSales, { refundedSaleIds });
      const file = new File(chunks, salesCsvFilename(tenantName, bounds), {
        type: SALES_CSV_MIME_TYPE,
      });
      finish(await saveFile(file), file, forSales);
    } catch (error) {
      fail(error);
    }
  }

  async function handleShare(file: File) {
    try {
      finish(await shareFile(file), file, sales);
    } catch (error) {
      fail(error);
    }
  }

  if (readyFile) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => void handleShare(readyFile)}
      >
        <Share className="size-4" aria-hidden />
        Compartir CSV
      </Button>
    );
  }

  const building = state.status === "building";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={building}
      aria-busy={building}
      onClick={() => void handleExport()}
      aria-label="Exportar ventas del período a CSV"
    >
      <Download className="size-4" aria-hidden />
      {building ? "Exportando…" : "CSV"}
    </Button>
  );
}
