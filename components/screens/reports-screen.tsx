"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Info, Wallet } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { BarRow } from "@/components/atoms/bar-row";
import { MetricCard } from "@/components/atoms/metric-card";
import { SaleRow } from "@/components/molecules/sale-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isInsideRange,
  minutesSince,
  parseCustomRangeBound,
} from "@/lib/dates";
import { formatBs } from "@/lib/money";
import {
  computeCategoryTotals,
  computeMetrics,
  computePaymentTotals,
  computeProductTotals,
  computeUserTotals,
} from "@/lib/sales";
import {
  compareStockSeverity,
  computeTrackedProductStock,
  stockStateWord,
  stockValueLabel,
} from "@/lib/inventory";
import type { Product, ReportRange, Sale } from "@/lib/types";

type ReportsScreenProps = {
  sales: Sale[];
  products: Product[];
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  openSale: (saleId: string) => void;
  voidSale: (saleId: string) => void;
  refundSale: (saleId: string) => void;
};

const ranges: [ReportRange, string][] = [
  ["today", "Hoy"],
  ["week", "Esta semana"],
  ["month", "Este mes"],
  ["custom", "Rango"],
];

function ReportList({
  rows,
  empty,
}: {
  rows: { key: string; title: string; subtitle: string; value: string }[];
  empty: string;
}) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="grid">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex min-h-12 items-center justify-between gap-3.5 border-b border-border py-2 last:border-b-0"
        >
          <span>
            <strong className="block text-sm font-semibold">{row.title}</strong>
            <small className="block text-xs text-muted-foreground">
              {row.subtitle}
            </small>
          </span>
          <b className="whitespace-nowrap tabular-nums">{row.value}</b>
        </div>
      ))}
    </div>
  );
}

export function ReportsScreen({
  sales,
  products,
  stockByProduct,
  inventoryStockReady,
  openSale,
  voidSale,
  refundSale,
}: ReportsScreenProps) {
  const [range, setRange] = useState<ReportRange>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showAllSales, setShowAllSales] = useState(false);

  useEffect(() => {
    setShowAllSales(false);
  }, [customEnd, customStart, range]);
  const visibleSales = useMemo(
    () =>
      sales.filter((sale) => {
        if (range !== "custom") {
          return isInsideRange(sale.createdAt, range);
        }

        const saleTime = new Date(sale.createdAt).getTime();
        if (Number.isNaN(saleTime)) {
          return false;
        }
        const rawStart = customStart
          ? parseCustomRangeBound(customStart, false)
          : Number.NEGATIVE_INFINITY;
        const rawEnd = customEnd
          ? parseCustomRangeBound(customEnd, true)
          : Number.POSITIVE_INFINITY;
        const startTime = Math.min(rawStart, rawEnd);
        const endTime = Math.max(rawStart, rawEnd);

        return saleTime >= startTime && saleTime <= endTime;
      }),
    [customEnd, customStart, sales, range]
  );
  const metrics = computeMetrics(visibleSales);
  const categoryTotals = computeCategoryTotals(visibleSales);
  const paymentTotals = computePaymentTotals(visibleSales);
  const productTotals = computeProductTotals(visibleSales);
  const userTotals = computeUserTotals(visibleSales);
  const trackedStock = inventoryStockReady
    ? computeTrackedProductStock(products, stockByProduct).sort((a, b) =>
        compareStockSeverity(a.stock.state, b.stock.state)
      )
    : [];
  const oversoldProducts = trackedStock.filter(
    ({ stock }) => stock.state === "oversold"
  );
  const averageTicketCents = metrics.transactionCount
    ? Math.round(metrics.netRevenueCents / metrics.transactionCount)
    : 0;
  const refundedIds = new Set(
    sales.map((sale) => sale.refundOfSaleId).filter(Boolean)
  );
  const hasMoreSales = visibleSales.length > 8;
  const displayedSales =
    showAllSales || !hasMoreSales ? visibleSales : visibleSales.slice(0, 8);

  return (
    <section className="screen">
      <Header
        title="Reportes"
        left={<BrandMark />}
        right={
          <span
            className="grid size-10 place-items-center text-primary"
            aria-hidden
          >
            <BarChart3 className="size-[23px]" />
          </span>
        }
      />

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ranges.map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={range === value ? "default" : "outline"}
            className="shrink-0 rounded-full px-4"
            onClick={() => setRange(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {range === "custom" ? (
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <Label className="grid gap-1.5 text-xs font-bold text-muted-foreground">
            Desde
            <Input
              type="date"
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
              className="h-11 rounded-xl"
            />
          </Label>
          <Label className="grid gap-1.5 text-xs font-bold text-muted-foreground">
            Hasta
            <Input
              type="date"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
              className="h-11 rounded-xl"
            />
          </Label>
        </div>
      ) : null}

      <div className="relative mb-3 overflow-hidden rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <span className="text-sm text-muted-foreground">Ingreso neto</span>
        <strong className="mt-1 block text-3xl font-bold text-primary tabular-nums">
          {formatBs(metrics.netRevenueCents, true)}
        </strong>
        <Wallet className="absolute top-4 right-4 size-16 text-primary/5" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Bruto" value={formatBs(metrics.grossCents, true)} />
        <MetricCard label="Ventas" value={String(metrics.transactionCount)} />
        <MetricCard
          label="Ganancia"
          value={formatBs(metrics.netEarningsCents, true)}
          tone="green"
        />
        <MetricCard
          label="Descuentos"
          value={formatBs(metrics.discountCents, true)}
        />
        <MetricCard
          label="Costo"
          value={formatBs(metrics.costCents, true)}
          warning={metrics.hasUnknownCost}
        />
        <MetricCard
          label="Ticket prom."
          value={formatBs(averageTicketCents, true)}
        />
        <MetricCard label="Reembolsos" value={String(metrics.refundCount)} />
      </div>

      {metrics.hasUnknownCost ? (
        <div className="my-3 flex gap-2 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber-surface)] p-3 text-sm text-[var(--amber)]">
          <Info className="size-[17px] shrink-0" />
          Ganancia es un máximo estimado porque algunos productos no tienen
          costo registrado.
        </div>
      ) : null}

      <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-3.5 text-lg font-semibold">Ventas por categoría</h2>
        {categoryTotals.length ? (
          categoryTotals.map((item) => (
            <BarRow
              key={item.category}
              label={item.category}
              value={item.total}
              max={categoryTotals[0].total}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Aún no hay ventas en este rango.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-3.5 text-lg font-semibold">Pago</h2>
        {paymentTotals.length ? (
          paymentTotals.map((item) => (
            <BarRow
              key={item.label}
              label={item.label}
              value={item.total}
              max={Math.max(
                ...paymentTotals.map((total) => Math.abs(total.total))
              )}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Aún no hay pagos en este rango.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-3.5 text-lg font-semibold">Más vendidos</h2>
        <ReportList
          empty="Aún no hay productos vendidos en este rango."
          rows={productTotals.slice(0, 6).map((item) => ({
            key: item.productId,
            title: item.productName,
            subtitle: `${item.quantity} unidades`,
            value: formatBs(item.total, true),
          }))}
        />
      </section>

      {trackedStock.length ? (
        <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="mb-1.5 text-lg font-semibold">Inventario actual</h2>
          <p className="mb-2.5 text-sm text-muted-foreground">
            Stock actual, independiente del rango seleccionado.
          </p>
          <ReportList
            empty=""
            rows={trackedStock.map(({ product, stock }) => ({
              key: product.id,
              title: product.name,
              subtitle: stockStateWord(stock),
              value: stockValueLabel(stock),
            }))}
          />
          {oversoldProducts.length ? (
            <p className="mt-2.5 text-sm text-muted-foreground">
              {oversoldProducts.length} producto
              {oversoldProducts.length === 1 ? "" : "s"} con sobreventa.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-3.5 text-lg font-semibold">Por vendedor</h2>
        <ReportList
          empty="Aún no hay vendedores con ventas en este rango."
          rows={userTotals.map((item) => ({
            key: item.userId,
            title: item.userName,
            subtitle: `${item.transactionCount} ventas`,
            value: formatBs(item.total, true),
          }))}
        />
      </section>

      <section className="mt-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ventas recientes</h2>
          {hasMoreSales ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              onClick={() => setShowAllSales((current) => !current)}
            >
              {showAllSales ? "Ver menos" : "Ver todo"}
            </Button>
          ) : null}
        </div>
        {displayedSales.map((sale) => {
          const canVoid =
            sale.status === "completed" &&
            !refundedIds.has(sale.id) &&
            minutesSince(sale.createdAt) <= 10;
          const canRefund =
            sale.status === "completed" && !refundedIds.has(sale.id);
          return (
            <SaleRow
              key={sale.id}
              sale={sale}
              canVoid={canVoid}
              canRefund={canRefund}
              openSale={openSale}
              voidSale={voidSale}
              refundSale={refundSale}
            />
          );
        })}
      </section>
    </section>
  );
}
