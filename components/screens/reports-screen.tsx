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
import { computeCategoryTotals, computeMetrics } from "@/lib/sales";
import type { ReportRange, Sale } from "@/lib/types";

type ReportsScreenProps = {
  sales: Sale[];
  openSale: (saleId: string) => void;
  voidSale: (saleId: string) => void;
  refundSale: (saleId: string) => void;
};

export function ReportsScreen({ sales, openSale, voidSale, refundSale }: ReportsScreenProps) {
  const [range, setRange] = useState<ReportRange>("today");
  const visibleSales = useMemo(() => sales.filter((sale) => isInsideRange(sale.createdAt, range)), [sales, range]);
  const metrics = computeMetrics(visibleSales);
  const categoryTotals = computeCategoryTotals(visibleSales);
  const refundedIds = new Set(sales.map((sale) => sale.refundOfSaleId).filter(Boolean));

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
        ].map(([value, label]) => (
          <button key={value} className={range === value ? "selected" : ""} onClick={() => setRange(value as ReportRange)}>
            {label}
          </button>
        ))}
      </div>
      <div className="metric-hero">
        <span>Ingreso neto</span>
        <strong>{formatBs(metrics.netRevenueCents, true)}</strong>
        <Wallet size={66} />
      </div>
      <div className="metric-grid">
        <MetricCard label="Ventas" value={String(metrics.transactionCount)} />
        <MetricCard label="Ganancia" value={formatBs(metrics.netEarningsCents, true)} tone="green" />
        <MetricCard label="Descuentos" value={formatBs(metrics.discountCents, true)} />
        <MetricCard label="Costo" value={formatBs(metrics.costCents, true)} warning={metrics.hasUnknownCost} />
      </div>
      {metrics.hasUnknownCost ? (
        <div className="cost-warning">
          <Info size={17} />
          Ganancia es un máximo estimado porque algunos productos no tienen costo registrado.
        </div>
      ) : null}
      <section className="panel">
        <h2>Ventas por categoría</h2>
        {categoryTotals.length ? (
          categoryTotals.map((item) => <BarRow key={item.category} label={item.category} value={item.total} max={categoryTotals[0].total} />)
        ) : (
          <p className="empty-copy">Aún no hay ventas en este rango.</p>
        )}
      </section>
      <section className="panel recent-panel">
        <div className="section-title">
          <h2>Ventas recientes</h2>
          <button>Ver todo</button>
        </div>
        {visibleSales.slice(0, 8).map((sale) => {
          const canVoid = sale.status === "completed" && !refundedIds.has(sale.id) && minutesSince(sale.createdAt) <= 10;
          const canRefund = sale.status === "completed" && !refundedIds.has(sale.id);
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
