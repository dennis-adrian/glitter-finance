"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, ReceiptText } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { Header } from "@/components/atoms/header";
import { DateRangePicker } from "@/components/molecules/date-range-picker";
import { EmptyState } from "@/components/molecules/empty-state";
import { SaleActionDialog } from "@/components/molecules/sale-action-dialog";
import { SaleRow } from "@/components/molecules/sale-row";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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

function IncomeInfoDrawer() {
  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger
        type="button"
        className="-my-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="Información sobre ingresos"
      >
        <Info className="size-[17px]" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Bruto y neto</DrawerTitle>
          <DrawerDescription>
            Dos formas de entender los ingresos de tus ventas.
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-4 p-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center rounded-2xl bg-secondary/60 p-3 text-center">
            <div>
              <span className="block text-xs text-muted-foreground">Bruto</span>
              <strong className="text-base tabular-nums">100 Bs</strong>
            </div>
            <span className="text-sm text-muted-foreground">−10 Bs</span>
            <div>
              <span className="block text-xs text-muted-foreground">Neto</span>
              <strong className="text-base text-primary tabular-nums">
                90 Bs
              </strong>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            La diferencia son los descuentos por producto o por venta.
          </p>
          <p className="text-sm text-muted-foreground">
            Los costos de productos no se descuentan aquí: afectan la ganancia
            en Reportes. Los reembolsos restan de ambos importes y las ventas
            anuladas no cuentan.
          </p>
        </div>
        <DrawerFooter>
          <DrawerClose className="inline-flex h-11 items-center justify-center rounded-4xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_8%)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Entendido
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

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
    if (!canRefundSale(action.sale, sales)) return false;
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

      <section className="mb-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Ingresos</h2>
          <IncomeInfoDrawer />
        </div>
        <div className="grid grid-cols-2 divide-x divide-border">
          <div className="min-w-0 pr-3">
            <span className="text-sm text-muted-foreground">Bruto</span>
            <strong className="mt-1 block text-xl font-bold tabular-nums">
              {formatBs(metrics.grossCents, true)}
            </strong>
          </div>
          <div className="min-w-0 pl-3">
            <span className="text-sm text-muted-foreground">Neto</span>
            <strong className="mt-1 block text-xl font-bold text-primary tabular-nums">
              {formatBs(metrics.netRevenueCents, true)}
            </strong>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {metrics.transactionCount} venta
          {metrics.transactionCount === 1 ? "" : "s"}
          {metrics.refundCount
            ? ` · ${metrics.refundCount} reembolso${
                metrics.refundCount === 1 ? "" : "s"
              }`
            : ""}
        </p>
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
