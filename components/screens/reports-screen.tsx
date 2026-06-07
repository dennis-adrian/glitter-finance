"use client";

import { useMemo, useState } from "react";
import { BarChart3, Info, Wallet } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { BarRow } from "@/components/atoms/bar-row";
import { MetricCard } from "@/components/atoms/metric-card";
import { SaleRow } from "@/components/molecules/sale-row";
import { minutesSince, isInsideRange } from "@/lib/dates";
import { formatBs } from "@/lib/money";
import {
  computeCategoryTotals,
  computeMetrics,
  computePaymentTotals,
  computeProductTotals,
  computeUserTotals,
} from "@/lib/sales";
import type { ReportRange, Sale } from "@/lib/types";

type ReportsScreenProps = {
  sales: Sale[];
  openSale: (saleId: string) => void;
  voidSale: (saleId: string) => void;
  refundSale: (saleId: string) => void;
};

export function ReportsScreen({
  sales,
  openSale,
  voidSale,
  refundSale,
}: ReportsScreenProps) {
  const [range, setRange] = useState<ReportRange>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const visibleSales = useMemo(
    () =>
      sales.filter((sale) => {
        if (range !== "custom") {
          return isInsideRange(sale.createdAt, range);
        }

        const saleTime = new Date(sale.createdAt).getTime();
        const startTime = customStart
          ? new Date(`${customStart}T00:00:00`).getTime()
          : Number.NEGATIVE_INFINITY;
        const endTime = customEnd
          ? new Date(`${customEnd}T23:59:59.999`).getTime()
          : Number.POSITIVE_INFINITY;

        return saleTime >= startTime && saleTime <= endTime;
      }),
    [customEnd, customStart, sales, range]
  );
  const metrics = computeMetrics(visibleSales);
  const categoryTotals = computeCategoryTotals(visibleSales);
  const paymentTotals = computePaymentTotals(visibleSales);
  const productTotals = computeProductTotals(visibleSales);
  const userTotals = computeUserTotals(visibleSales);
  const averageTicketCents = metrics.transactionCount
    ? Math.round(metrics.netRevenueCents / metrics.transactionCount)
    : 0;
  const refundedIds = new Set(
    sales.map((sale) => sale.refundOfSaleId).filter(Boolean)
  );

  return (
    <section className="screen reports-screen">
      <Header
        title="Reportes"
        left={<BrandMark />}
        right={
          <button className="icon-button" aria-label="Reportes">
            <BarChart3 size={23} />
          </button>
        }
      />
      <div className="range-row">
        {[
          ["today", "Hoy"],
          ["week", "Esta semana"],
          ["month", "Este mes"],
          ["custom", "Rango"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={range === value ? "selected" : ""}
            onClick={() => setRange(value as ReportRange)}
          >
            {label}
          </button>
        ))}
      </div>
      {range === "custom" ? (
        <div className="custom-range-row">
          <label>
            Desde
            <input
              type="date"
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <div className="metric-hero">
        <span>Ingreso neto</span>
        <strong>{formatBs(metrics.netRevenueCents, true)}</strong>
        <Wallet size={66} />
      </div>
      <div className="metric-grid">
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
        <div className="cost-warning">
          <Info size={17} />
          Ganancia es un máximo estimado porque algunos productos no tienen
          costo registrado.
        </div>
      ) : null}
      <section className="panel">
        <h2>Ventas por categoría</h2>
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
          <p className="empty-copy">Aún no hay ventas en este rango.</p>
        )}
      </section>
      <section className="panel">
        <h2>Pago</h2>
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
          <p className="empty-copy">Aún no hay pagos en este rango.</p>
        )}
      </section>
      <section className="panel">
        <h2>Más vendidos</h2>
        {productTotals.length ? (
          <div className="report-list">
            {productTotals.slice(0, 6).map((item) => (
              <div className="report-list-row" key={item.productName}>
                <span>
                  <strong>{item.productName}</strong>
                  <small>{item.quantity} unidades</small>
                </span>
                <b>{formatBs(item.total, true)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-copy">
            Aún no hay productos vendidos en este rango.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Por vendedor</h2>
        {userTotals.length ? (
          <div className="report-list">
            {userTotals.map((item) => (
              <div className="report-list-row" key={item.userName}>
                <span>
                  <strong>{item.userName}</strong>
                  <small>{item.transactionCount} ventas</small>
                </span>
                <b>{formatBs(item.total, true)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-copy">
            Aún no hay vendedores con ventas en este rango.
          </p>
        )}
      </section>
      <section className="panel recent-panel">
        <div className="section-title">
          <h2>Ventas recientes</h2>
          <button>Ver todo</button>
        </div>
        {visibleSales.slice(0, 8).map((sale) => {
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
