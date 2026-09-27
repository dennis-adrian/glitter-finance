"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { Screen } from "@/components/templates/screen";
import { BarRow } from "@/components/atoms/bar-row";
import { MetricCard } from "@/components/atoms/metric-card";
import { DateRangePicker } from "@/components/molecules/date-range-picker";
import { SalesTrendChart } from "@/components/molecules/sales-trend-chart";
import { Button } from "@/components/ui/button";
import {
  filterSalesByRange,
  formatDateInputInBolivia,
  resolveSalesRange,
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
import {
  buildTrendBuckets,
  comparisonWindow,
  filterByBounds,
  percentChange,
} from "@/lib/reports";
import type { Product, ReportRange, Sale } from "@/lib/types";
import { cn } from "@/lib/utils";

type ReportsScreenProps = {
  sales: Sale[];
  products: Product[];
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  openSales: () => void;
};

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
  openSales,
}: ReportsScreenProps) {
  const today = formatDateInputInBolivia();
  const [range, setRange] = useState<ReportRange>("today");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const rangeResolution = resolveSalesRange(
    range,
    customStart,
    customEnd,
    new Date(now)
  );
  const visibleSales = useMemo(
    () =>
      filterSalesByRange(sales, range, customStart, customEnd, new Date(now)),
    [customEnd, customStart, now, range, sales]
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
  const unitsSold = productTotals.reduce(
    (total, item) => total + item.quantity,
    0
  );
  const bounds = rangeResolution.bounds;
  const comparison = bounds ? comparisonWindow(range, bounds, now) : null;
  const previousMetrics = computeMetrics(
    comparison ? filterByBounds(sales, comparison.bounds) : []
  );
  const trend = bounds ? buildTrendBuckets(visibleSales, bounds, now) : [];
  const trendTitle =
    trend.length && bounds && bounds.end - bounds.start <= 24 * 60 * 60 * 1000
      ? "Ingreso neto por hora"
      : "Ingreso neto por día";

  function handleRangeChange(nextRange: ReportRange) {
    if (nextRange === "custom" && range !== "custom") {
      const date = formatDateInputInBolivia(new Date(now));
      setCustomStart(date);
      setCustomEnd(date);
    }
    setRange(nextRange);
  }

  return (
    <Screen header={<ScreenHeader title="Reportes" />}>
      <DateRangePicker
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        error={range === "custom" ? rangeResolution.error : null}
        setRange={handleRangeChange}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
      />

      <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="text-sm text-muted-foreground">Ingreso neto</h2>
            <strong className="mt-1 block text-5xl leading-none font-bold text-primary">
              {formatBs(metrics.netRevenueCents, true)}
            </strong>
          </div>
          {comparison ? (
            <DeltaBadge
              change={percentChange(
                metrics.netRevenueCents,
                previousMetrics.netRevenueCents
              )}
              label={comparison.label}
            />
          ) : null}
        </div>
        {trend.length ? (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              {trendTitle}
            </p>
            <SalesTrendChart buckets={trend} title={trendTitle} />
          </div>
        ) : null}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Ventas"
          value={String(metrics.transactionCount)}
          detail={
            comparison ? (
              <DeltaText
                change={percentChange(
                  metrics.transactionCount,
                  previousMetrics.transactionCount
                )}
                label={comparison.label}
              />
            ) : null
          }
        />
        <MetricCard
          label="Ticket promedio"
          value={formatBs(averageTicketCents, true)}
        />
        <MetricCard
          label="Ganancia"
          value={formatBs(metrics.netEarningsCents, true)}
          tone="green"
          warning={metrics.hasUnknownCost}
        />
        <MetricCard label="Unidades vendidas" value={String(unitsSold)} />
        <MetricCard label="Bruto" value={formatBs(metrics.grossCents, true)} />
        <MetricCard
          label="Descuentos"
          value={formatBs(metrics.discountCents, true)}
        />
        <MetricCard
          label="Costo"
          value={formatBs(metrics.costCents, true)}
          warning={metrics.hasUnknownCost}
        />
        <MetricCard label="Reembolsos" value={String(metrics.refundCount)} />
      </div>

      {metrics.hasUnknownCost ? (
        <div className="mt-3 flex gap-2 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber-surface)] p-3 text-sm text-[var(--amber)]">
          <Info className="size-[17px] shrink-0" />
          La ganancia es un máximo estimado porque algunos productos no tienen
          costo registrado.
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="mb-3.5 text-base font-bold">Ventas por categoría</h2>
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
              Todavía no hay ventas en este período.
            </p>
          )}
        </section>

        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="mb-3.5 text-base font-bold">Métodos de pago</h2>
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
              Todavía no hay pagos en este período.
            </p>
          )}
        </section>

        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="mb-3.5 text-base font-bold">Más vendidos</h2>
          <ReportList
            empty="Todavía no hay productos vendidos en este período."
            rows={productTotals.slice(0, 6).map((item) => ({
              key: item.productId,
              title: item.productName,
              subtitle: `${item.quantity} ${item.quantity === 1 ? "unidad" : "unidades"}`,
              value: formatBs(item.total, true),
            }))}
          />
        </section>

        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="mb-3.5 text-base font-bold">Por vendedor</h2>
          <ReportList
            empty="Todavía no hay vendedores con ventas en este período."
            rows={userTotals.map((item) => ({
              key: item.userId,
              title: item.userName,
              subtitle: `${item.transactionCount} ${item.transactionCount === 1 ? "venta" : "ventas"}`,
              value: formatBs(item.total, true),
            }))}
          />
        </section>

        {trackedStock.length ? (
          <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10 lg:col-span-2">
            <h2 className="mb-1.5 text-base font-bold">Inventario actual</h2>
            <p className="mb-2.5 text-sm text-muted-foreground">
              Stock actual, sin importar el período elegido.
              {oversoldProducts.length
                ? ` ${oversoldProducts.length} ${oversoldProducts.length === 1 ? "producto" : "productos"} con sobreventa.`
                : ""}
            </p>
            <div className="lg:columns-2 lg:gap-8">
              <ReportList
                empty=""
                rows={trackedStock.map(({ product, stock }) => ({
                  key: product.id,
                  title: product.name,
                  subtitle: stockStateWord(stock),
                  value: stockValueLabel(stock),
                }))}
              />
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
          <div>
            <h2 className="text-base font-bold">Registro de ventas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Consultá, anulá o reembolsá ventas desde su propio registro.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={openSales}>
            Ver ventas
          </Button>
        </section>
      </div>
    </Screen>
  );
}

function DeltaBadge({
  change,
  label,
}: {
  change: number | null;
  label: string;
}) {
  if (change == null) {
    return (
      <span className="text-sm text-muted-foreground">
        Sin ventas para comparar {label.replace("vs. ", "con ")}
      </span>
    );
  }
  const up = change >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold",
        up ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
      )}
    >
      <Icon className="size-4" aria-hidden />
      {up ? "+" : "−"}
      {Math.abs(change)}%
      <span className="font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

function DeltaText({
  change,
  label,
}: {
  change: number | null;
  label: string;
}) {
  if (change == null) return null;
  const up = change >= 0;
  return (
    <small
      className={cn(
        "text-xs font-semibold",
        up ? "text-primary" : "text-destructive"
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(change)}%{" "}
      <span className="font-normal text-muted-foreground">{label}</span>
    </small>
  );
}
