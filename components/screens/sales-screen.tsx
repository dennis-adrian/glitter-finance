"use client";

import { useMemo, useState } from "react";
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
import { formatBs } from "@/lib/money";
import { countLabel } from "@/lib/plural";
import { computeMetrics, indexSales } from "@/lib/sales";
import type { Sale } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { useSalesInRange, useSalesRangeState } from "@/lib/use-sales-range";
import {
  canRefundSale,
  canVoidSale,
  saleActionBlockedMessage,
  saleStatusLabel,
  type SaleAction,
} from "@/components/screens/sale-detail-screen.helpers";
import {
  firstSalesByDay,
  groupSalesByDay,
} from "@/components/screens/sales-screen.helpers";

type SalesScreenProps = {
  sales: Sale[];
  openSale: (saleId: string) => void;
  voidSale: (saleId: string) => Promise<boolean>;
  refundSale: (saleId: string, reason?: string) => Promise<boolean>;
};

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
  const rangeState = useSalesRangeState();
  const [now, setNow] = useNow();
  const [action, setAction] = useState<{
    sale: Sale;
    type: SaleAction;
  } | null>(null);

  // Everything below is derived once per change of the sales, the range or
  // the page, not on every render or tick of `now`: the rows look sales up
  // in the index instead of scanning the whole list for each row.
  const saleIndex = useMemo(() => indexSales(sales), [sales]);
  const { error: rangeError, sales: salesInRange } = useSalesInRange(
    sales,
    rangeState,
    now
  );
  const metrics = useMemo(() => computeMetrics(salesInRange), [salesInRange]);
  const dayGroups = useMemo(
    () => groupSalesByDay(salesInRange),
    [salesInRange]
  );
  const visibleCount = rangeState.salesListLength;
  const groups = useMemo(
    () => firstSalesByDay(dayGroups, visibleCount),
    [dayGroups, visibleCount]
  );

  // A refusal is thrown, so the dialog shows why instead of a generic
  // failure; the rows re-check the void window too.
  async function confirmAction(reason?: string) {
    if (!action) return false;
    const checkedAt = Date.now();
    const blocked = saleActionBlockedMessage(
      action.type,
      action.sale,
      saleIndex,
      checkedAt
    );
    if (blocked) {
      setNow(checkedAt);
      throw new Error(blocked);
    }
    return action.type === "void"
      ? voidSale(action.sale.id)
      : refundSale(action.sale.id, reason);
  }

  function requestVoid(selectedSale: Sale) {
    const checkedAt = Date.now();
    if (!canVoidSale(selectedSale, saleIndex, checkedAt)) {
      setNow(checkedAt);
      return;
    }
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
        range={rangeState.range}
        customStart={rangeState.customStart}
        customEnd={rangeState.customEnd}
        error={rangeState.range === "custom" ? rangeError : null}
        setRange={rangeState.setRange}
        setCustomStart={rangeState.setCustomStart}
        setCustomEnd={rangeState.setCustomEnd}
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
          {countLabel(metrics.transactionCount, "venta", "ventas")}
          {metrics.refundCount
            ? ` · ${countLabel(metrics.refundCount, "reembolso", "reembolsos")}`
            : ""}
        </p>
      </section>

      {rangeError ? (
        <EmptyState
          icon={<ReceiptText size={46} />}
          title="Revisa el rango"
          body={rangeError}
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
                  canVoid={canVoidSale(sale, saleIndex, now)}
                  canRefund={canRefundSale(sale, saleIndex)}
                  statusLabel={saleStatusLabel(sale, saleIndex)}
                  openSale={openSale}
                  requestVoid={requestVoid}
                  requestRefund={(selectedSale) =>
                    setAction({ sale: selectedSale, type: "refund" })
                  }
                />
              ))}
            </section>
          ))}

          {visibleCount < salesInRange.length ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={rangeState.showMoreSales}
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
