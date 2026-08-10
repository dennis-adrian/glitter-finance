"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Info, Wallet } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { BarRow } from "@/components/atoms/bar-row";
import { MetricCard } from "@/components/atoms/metric-card";
import { DateRangePicker } from "@/components/molecules/date-range-picker";
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
import type { Product, ReportRange, Sale } from "@/lib/types";

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

  function handleRangeChange(nextRange: ReportRange) {
    if (nextRange === "custom" && range !== "custom") {
      const date = formatDateInputInBolivia(new Date(now));
      setCustomStart(date);
      setCustomEnd(date);
    }
    setRange(nextRange);
  }

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

      <DateRangePicker
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        error={range === "custom" ? rangeResolution.error : null}
        setRange={handleRangeChange}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
      />

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
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Registro de ventas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Consulta, anula o reembolsa ventas desde su propio registro.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={openSales}>
            Ver ventas
          </Button>
        </div>
      </section>
    </section>
  );
}
