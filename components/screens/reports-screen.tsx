"use client";

import { useMemo, useState } from "react";
import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { Screen } from "@/components/templates/screen";
import { BarRow } from "@/components/atoms/bar-row";
import { MetricCard } from "@/components/atoms/metric-card";
import { DateRangePicker } from "@/components/molecules/date-range-picker";
import { SalesTrendChart } from "@/components/molecules/sales-trend-chart";
import { Button } from "@/components/ui/button";
import { filterSalesByBounds, resolveSalesRange } from "@/lib/dates";
import { formatBs } from "@/lib/money";
import { countLabel } from "@/lib/plural";
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
  comparisonCovered,
  comparisonWindow,
  noComparisonText,
  percentChange,
  trendGranularity,
} from "@/lib/reports";
import type { Product, Sale } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { useSalesInRange, type SalesRangeState } from "@/lib/use-sales-range";
import { cn } from "@/lib/utils";

/** How many products "Más vendidos" lists before "Ver todos". */
const TOP_PRODUCTS_COUNT = 6;

/**
 * The bar scale of a breakdown. A refund of an earlier sale can make a row
 * negative, so bars scale to the largest amount either way.
 */
function largestAmount(rows: { total: number }[]) {
  return Math.max(0, ...rows.map((row) => Math.abs(row.total)));
}

type ReportsScreenProps = {
  sales: Sale[];
  /** Shared with Sales, so both screens show the same range. */
  rangeState: SalesRangeState;
  products: Product[];
  stockByProduct: Map<string, number>;
  inventoryStockReady: boolean;
  /**
   * Where the loaded sales start when they are not the whole history (before
   * a PowerSync device's first sync); null when every sale is loaded. A
   * comparison that reaches before it is hidden rather than undercounted.
   */
  salesHistoryStart: number | null;
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
  rangeState,
  products,
  stockByProduct,
  inventoryStockReady,
  salesHistoryStart,
}: ReportsScreenProps) {
  const [now] = useNow();
  const [showAllProducts, setShowAllProducts] = useState(false);

  // Computed once per change of the sales or the range, not on every tick
  // of `now` or toggle of the product list.
  const { error: rangeError, sales: salesInRange } = useSalesInRange(
    sales,
    rangeState,
    now
  );
  const { metrics, categoryTotals, paymentTotals, productTotals, userTotals } =
    useMemo(
      () => ({
        metrics: computeMetrics(salesInRange),
        categoryTotals: computeCategoryTotals(salesInRange),
        paymentTotals: computePaymentTotals(salesInRange),
        productTotals: computeProductTotals(salesInRange),
        userTotals: computeUserTotals(salesInRange),
      }),
      [salesInRange]
    );
  const trackedStock = useMemo(
    () =>
      inventoryStockReady
        ? computeTrackedProductStock(products, stockByProduct).sort((a, b) =>
            compareStockSeverity(a.stock.state, b.stock.state)
          )
        : [],
    [inventoryStockReady, products, stockByProduct]
  );
  const oversoldCount = trackedStock.filter(
    ({ stock }) => stock.state === "oversold"
  ).length;
  const listedProducts = showAllProducts
    ? productTotals
    : productTotals.slice(0, TOP_PRODUCTS_COUNT);
  const unitsSold = productTotals.reduce(
    (total, item) => total + item.quantity,
    0
  );

  // The comparison and the trend follow `now` (a partial day is compared
  // with the same part of the day before), so they refresh with each tick.
  const { range, customStart, customEnd } = rangeState;
  const { bounds } = resolveSalesRange(
    range,
    customStart,
    customEnd,
    new Date(now)
  );
  const start = bounds?.start;
  const end = bounds?.end;
  const { comparison, previousMetrics, trend, trendTitle } = useMemo(() => {
    if (start === undefined || end === undefined) {
      return {
        comparison: null,
        previousMetrics: computeMetrics([]),
        trend: [],
        trendTitle: "",
      };
    }
    const rangeBounds = { start, end };
    const previous = comparisonWindow(range, rangeBounds, now);
    return {
      comparison: comparisonCovered(previous.bounds, salesHistoryStart)
        ? previous
        : null,
      previousMetrics: computeMetrics(
        filterSalesByBounds(sales, previous.bounds)
      ),
      trend: buildTrendBuckets(salesInRange, rangeBounds, now),
      trendTitle: {
        hour: "Ingreso neto por hora",
        day: "Ingreso neto por día",
        week: "Ingreso neto por semana",
      }[trendGranularity(rangeBounds, now)],
    };
  }, [sales, salesInRange, range, start, end, now, salesHistoryStart]);

  return (
    <Screen header={<ScreenHeader title="Reportes" />}>
      <DateRangePicker
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        error={range === "custom" ? rangeError : null}
        setRange={rangeState.setRange}
        setCustomStart={rangeState.setCustomStart}
        setCustomEnd={rangeState.setCustomEnd}
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
              emptyText={noComparisonText(
                previousMetrics.transactionCount,
                comparison
              )}
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
          value={formatBs(metrics.averageTicketCents, true)}
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
        <MetricCard
          label="Reembolsos"
          value={formatBs(metrics.refundedCents, true)}
          detail={
            <small className="text-xs text-muted-foreground">
              {countLabel(metrics.refundCount, "reembolso", "reembolsos")}
            </small>
          }
        />
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
          <h2 className="mb-1.5 text-base font-bold">Ventas por categoría</h2>
          <p className="mb-3.5 text-sm text-muted-foreground">
            Montos netos, con descuentos y reembolsos: suman el ingreso neto.
          </p>
          {categoryTotals.length ? (
            categoryTotals.map((item) => (
              <BarRow
                key={item.category}
                label={item.category}
                value={item.total}
                max={largestAmount(categoryTotals)}
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
                max={largestAmount(paymentTotals)}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavía no hay pagos en este período.
            </p>
          )}
        </section>

        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="mb-1.5 text-base font-bold">Más vendidos</h2>
          <p className="mb-2.5 text-sm text-muted-foreground">
            Unidades vendidas e ingreso neto de cada producto.
          </p>
          <ReportList
            empty="Todavía no hay productos vendidos en este período."
            rows={listedProducts.map((item) => ({
              key: item.productId,
              title: item.productName,
              subtitle: countLabel(item.quantity, "unidad", "unidades"),
              value: formatBs(item.total, true),
            }))}
          />
          {productTotals.length > TOP_PRODUCTS_COUNT ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              aria-expanded={showAllProducts}
              onClick={() => setShowAllProducts((shown) => !shown)}
            >
              {showAllProducts
                ? "Ver menos"
                : `Ver todos (${productTotals.length})`}
            </Button>
          ) : null}
        </section>

        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 className="mb-1.5 text-base font-bold">Por vendedor</h2>
          <p className="mb-2.5 text-sm text-muted-foreground">
            Ingreso neto de las ventas de cada vendedor. Un reembolso se le
            resta a quien hizo la venta, aunque lo haya registrado otra persona.
          </p>
          <ReportList
            empty="Todavía no hay vendedores con ventas en este período."
            rows={userTotals.map((item) => ({
              key: item.userId,
              title: item.userName,
              subtitle: countLabel(item.transactionCount, "venta", "ventas"),
              value: formatBs(item.total, true),
            }))}
          />
        </section>

        {trackedStock.length ? (
          <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10 lg:col-span-2">
            <h2 className="mb-1.5 text-base font-bold">Inventario actual</h2>
            <p className="mb-2.5 text-sm text-muted-foreground">
              Stock actual, sin importar el período elegido.
              {oversoldCount
                ? ` ${countLabel(oversoldCount, "producto", "productos")} con sobreventa.`
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
      </div>
    </Screen>
  );
}

function DeltaBadge({
  change,
  label,
  emptyText,
}: {
  change: number | null;
  label: string;
  /** Shown when there is no change to show. */
  emptyText: string;
}) {
  if (change == null) {
    return <span className="text-sm text-muted-foreground">{emptyText}</span>;
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
