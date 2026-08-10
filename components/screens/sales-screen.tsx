"use client";

import { useEffect, useMemo, useState } from "react";
import { ReceiptText, Wallet } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { DateRangePicker } from "@/components/molecules/date-range-picker";
import { EmptyState } from "@/components/molecules/empty-state";
import { SaleActionDialog } from "@/components/molecules/sale-action-dialog";
import { SaleRow } from "@/components/molecules/sale-row";
import { Button } from "@/components/ui/button";
import {
  filterSalesByRange,
  formatDateInputInBolivia,
  formatDateLabelInBolivia,
  resolveSalesRange,
} from "@/lib/dates";
import { formatBs } from "@/lib/money";
import { computeMetrics } from "@/lib/sales";
import type { ReportRange, Sale } from "@/lib/types";
import {
  canRefundSale,
  canVoidSale,
  saleStatusLabel,
} from "@/components/screens/sale-detail-screen.helpers";

type SaleAction = "void" | "refund";

type SalesScreenProps = {
  sales: Sale[];
  openSale: (saleId: string) => void;
  voidSale: (saleId: string) => Promise<boolean>;
  refundSale: (saleId: string, reason?: string) => Promise<boolean>;
};

type SaleGroup = {
  key: string;
  label: string;
  sales: Sale[];
  netCents: number;
};

const PAGE_SIZE = 40;

export function SalesScreen({
  sales,
  openSale,
  voidSale,
  refundSale,
}: SalesScreenProps) {
  const today = formatDateInputInBolivia();
  const [range, setRange] = useState<ReportRange>("today");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [now, setNow] = useState(() => Date.now());
  const [action, setAction] = useState<{
    sale: Sale;
    type: SaleAction;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [range, customStart, customEnd]);

  const rangeResolution = resolveSalesRange(
    range,
    customStart,
    customEnd,
    new Date(now)
  );
  const visibleSales = useMemo(
    () =>
      filterSalesByRange(
        sales,
        range,
        customStart,
        customEnd,
        new Date(now)
      ).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [customEnd, customStart, now, range, sales]
  );
  const displayedSales = visibleSales.slice(0, visibleCount);
  const metrics = computeMetrics(visibleSales);
  const groups = useMemo(() => {
    const byDate = new Map<string, Sale[]>();

    for (const sale of displayedSales) {
      const date = formatDateInputInBolivia(new Date(sale.createdAt));
      byDate.set(date, [...(byDate.get(date) ?? []), sale]);
    }

    return [...byDate.entries()].map(
      ([key, rows]): SaleGroup => ({
        key,
        label: formatDateLabelInBolivia(rows[0].createdAt),
        sales: rows,
        netCents: computeMetrics(rows).netRevenueCents,
      })
    );
  }, [displayedSales]);

  function handleRangeChange(nextRange: ReportRange) {
    if (nextRange === "custom" && range !== "custom") {
      const date = formatDateInputInBolivia(new Date(now));
      setCustomStart(date);
      setCustomEnd(date);
    }
    setRange(nextRange);
  }

  async function confirmAction(reason?: string) {
    if (!action) return false;
    if (action.type === "void") {
      if (!canVoidSale(action.sale, sales, Date.now())) return false;
      return voidSale(action.sale.id);
    }
    return refundSale(action.sale.id, reason);
  }

  function requestVoid(selectedSale: Sale) {
    if (!canVoidSale(selectedSale, sales, Date.now())) return;
    setAction({ sale: selectedSale, type: "void" });
  }

  return (
    <section className="screen">
      <Header
        title="Ventas"
        left={<BrandMark />}
        right={
          <span
            className="grid size-10 place-items-center text-primary"
            aria-hidden
          >
            <ReceiptText className="size-[23px]" />
          </span>
        }
      />

      <DateRangePicker
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        error={range === "custom" ? rangeResolution.error : null}
        setRange={handleRangeChange}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
      />

      <section className="relative mb-4 overflow-hidden rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <span className="text-sm text-muted-foreground">Actividad neta</span>
        <strong className="mt-1 block text-3xl font-bold text-primary tabular-nums">
          {formatBs(metrics.netRevenueCents, true)}
        </strong>
        <p className="mt-1 text-sm text-muted-foreground">
          {metrics.transactionCount} venta
          {metrics.transactionCount === 1 ? "" : "s"}
          {metrics.refundCount
            ? ` · ${metrics.refundCount} reembolso${
                metrics.refundCount === 1 ? "" : "s"
              }`
            : ""}
        </p>
        <Wallet className="absolute top-4 right-4 size-16 text-primary/5" />
      </section>

      {rangeResolution.error ? (
        <EmptyState
          icon={<ReceiptText size={46} />}
          title="Revisa el rango"
          body={rangeResolution.error}
        />
      ) : groups.length ? (
        <div className="grid gap-4">
          {groups.map((group) => (
            <section
              key={group.key}
              className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10"
            >
              <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-border pb-2.5">
                <h2 className="capitalize text-sm font-bold">{group.label}</h2>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                  {formatBs(group.netCents, true)}
                </span>
              </div>
              {group.sales.map((sale) => (
                <SaleRow
                  key={sale.id}
                  sale={sale}
                  canVoid={canVoidSale(sale, sales, now)}
                  canRefund={canRefundSale(sale, sales)}
                  statusLabel={saleStatusLabel(sale, sales)}
                  openSale={openSale}
                  requestVoid={requestVoid}
                  requestRefund={(selectedSale) =>
                    setAction({ sale: selectedSale, type: "refund" })
                  }
                />
              ))}
            </section>
          ))}

          {visibleCount < visibleSales.length ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Ver más ventas
            </Button>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={<ReceiptText size={46} />}
          title="No hay ventas en este rango"
          body="Prueba con otras fechas o registra una venta desde Vender."
        />
      )}

      <SaleActionDialog
        key={action ? `${action.sale.id}-${action.type}` : "none"}
        sale={action?.sale ?? null}
        action={action?.type ?? null}
        onClose={() => setAction(null)}
        onConfirm={confirmAction}
      />
    </section>
  );
}
