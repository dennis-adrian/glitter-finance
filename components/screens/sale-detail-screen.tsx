import {
  AlertTriangle,
  ChevronLeft,
  Info,
  QrCode,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { DetailRow } from "@/components/atoms/detail-row";
import { Header } from "@/components/atoms/header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/molecules/empty-state";
import { SaleActionDialog } from "@/components/molecules/sale-action-dialog";
import { SaleLineDetail } from "@/components/molecules/sale-line-detail";
import { formatBs } from "@/lib/money";
import {
  paymentLabels,
  saleCostCents,
  saleDiscountTotalCents,
  saleGrossCents,
  saleHasUnknownCost,
  saleLineDiscountCents,
  saleNetCents,
  saleProfitCents,
} from "@/lib/sales";
import type { Sale } from "@/lib/types";
import {
  canRefundSale,
  canVoidSale,
  saleReferenceLabel,
  saleStatusLabel,
} from "@/components/screens/sale-detail-screen.helpers";

type SaleDetailScreenProps = {
  sale: Sale | null;
  sales: Sale[];
  back: () => void;
  voidSale: (saleId: string) => Promise<boolean>;
  refundSale: (saleId: string, reason?: string) => Promise<boolean>;
};

const dateFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: "America/La_Paz",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function BackButton({ back }: { back: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={back} aria-label="Volver">
      <ChevronLeft className="size-6" />
    </Button>
  );
}

export function SaleDetailScreen({
  sale,
  sales,
  back,
  voidSale,
  refundSale,
}: SaleDetailScreenProps) {
  const [action, setAction] = useState<"void" | "refund" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!sale) {
    return (
      <section className="screen">
        <Header title="Detalle" left={<BackButton back={back} />} />
        <EmptyState
          icon={<ReceiptText size={46} />}
          title="Venta no encontrada"
          body="La venta ya no está disponible en este dispositivo."
        />
      </section>
    );
  }

  const gross = saleGrossCents(sale);
  const cost = saleCostCents(sale);
  const net = saleNetCents(sale);
  const profit = saleProfitCents(sale);
  const lineDiscount = saleLineDiscountCents(sale);
  const totalDiscount = saleDiscountTotalCents(sale);
  const hasUnknownCost = saleHasUnknownCost(sale);
  const canVoid = canVoidSale(sale, sales, now);
  const canRefund = canRefundSale(sale, sales);
  const originalSale = sale.refundOfSaleId
    ? sales.find((item) => item.id === sale.refundOfSaleId)
    : null;
  const refundRecord = sales.find((item) => item.refundOfSaleId === sale.id);

  return (
    <section className="screen">
      <Header
        title="Detalle de venta"
        left={<BackButton back={back} />}
        right={<BrandMark size="small" />}
      />

      <section className="mb-3.5 rounded-2xl bg-card p-4 text-center ring-1 ring-foreground/10">
        <span className="inline-flex min-h-7 items-center rounded-full bg-primary/10 px-3 text-sm font-bold text-primary">
          {saleStatusLabel(sale, sales)}
        </span>
        <h2 className="mt-2.5 text-lg font-semibold">
          {saleReferenceLabel(sale)}
        </h2>
        <strong className="my-2 block text-4xl leading-none font-bold text-primary tabular-nums">
          {formatBs(net, true)}
        </strong>
        <p className="text-sm text-muted-foreground">
          {dateFormatter.format(new Date(sale.createdAt))}
        </p>
      </section>

      <section className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-2 text-lg font-semibold">Registro</h2>
        <DetailRow
          label="Referencia"
          value={saleReferenceLabel(sale)}
          tone="strong"
        />
        {originalSale ? (
          <DetailRow
            label="Venta original"
            value={saleReferenceLabel(originalSale)}
          />
        ) : null}
        {refundRecord ? (
          <DetailRow
            label="Reembolso"
            value={saleReferenceLabel(refundRecord)}
          />
        ) : null}
        {sale.refundReason ? (
          <DetailRow label="Motivo reembolso" value={sale.refundReason} />
        ) : null}
        <DetailRow
          label="Creada"
          value={dateFormatter.format(new Date(sale.createdAt))}
        />
        {sale.clientCreatedAt ? (
          <DetailRow
            label="Hora local"
            value={dateFormatter.format(new Date(sale.clientCreatedAt))}
          />
        ) : null}
        <DetailRow label="Registró" value={sale.userName} />
        <DetailRow
          label="Estado"
          value={saleStatusLabel(sale, sales)}
          tone={sale.status === "voided" ? "danger" : "strong"}
        />
        {sale.voidedAt ? (
          <DetailRow
            label="Anulada"
            value={dateFormatter.format(new Date(sale.voidedAt))}
            tone="danger"
          />
        ) : null}
      </section>

      <section className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-2 text-lg font-semibold">Pago</h2>
        <DetailRow
          label="Método"
          value={
            <span className="inline-flex items-center gap-1.5 text-foreground">
              {sale.paymentMethod === "cash" ? (
                <Wallet size={18} />
              ) : (
                <QrCode size={18} />
              )}
              {paymentLabels[sale.paymentMethod]}
            </span>
          }
        />
      </section>

      <section className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-3 text-lg font-semibold">Productos</h2>
        <div className="grid gap-2.5">
          {sale.lines.map((line) => (
            <SaleLineDetail key={line.id} line={line} />
          ))}
        </div>
      </section>

      <section className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-2 text-lg font-semibold">Totales</h2>
        <DetailRow label="Subtotal bruto" value={formatBs(gross, true)} />
        <DetailRow
          label="Descuento líneas"
          value={formatBs(lineDiscount, true)}
        />
        <DetailRow
          label="Descuento venta"
          value={formatBs(sale.saleDiscountCents, true)}
        />
        {sale.saleDiscountReason ? (
          <DetailRow label="Motivo descuento" value={sale.saleDiscountReason} />
        ) : null}
        <DetailRow
          label="Descuento total"
          value={formatBs(totalDiscount, true)}
        />
        <DetailRow label="Cobrado" value={formatBs(net, true)} tone="strong" />
        <DetailRow label="Costo de productos" value={formatBs(cost, true)} />
        <DetailRow
          label="Ganancia estimada"
          value={formatBs(profit, true)}
          tone={profit >= 0 ? "success" : "danger"}
        />
      </section>

      {hasUnknownCost ? (
        <div className="mt-3 flex gap-2 rounded-xl border border-[var(--amber)]/35 bg-[var(--amber-surface)] p-3 text-sm text-[var(--amber)]">
          <Info className="size-[17px] shrink-0" />
          La ganancia es un máximo estimado porque al menos un producto no tiene
          costo registrado.
        </div>
      ) : null}

      <section className="mt-4 mb-2 grid gap-2.5">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={!canVoid}
          onClick={() => {
            const checkedAt = Date.now();
            if (!canVoidSale(sale, sales, checkedAt)) {
              setNow(checkedAt);
              return;
            }
            setAction("void");
          }}
        >
          Anular venta
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={!canRefund}
          onClick={() => setAction("refund")}
        >
          Reembolsar venta
        </Button>
        {!canVoid && !canRefund ? (
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="size-[15px]" />
            Esta venta queda solo como registro. No hay acciones correctivas
            disponibles.
          </p>
        ) : null}
      </section>

      <SaleActionDialog
        key={action ? `${sale.id}-${action}` : "none"}
        sale={sale}
        action={action}
        onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          if (action === "void") {
            const checkedAt = Date.now();
            if (!canVoidSale(sale, sales, checkedAt)) {
              setNow(checkedAt);
              setAction(null);
              return false;
            }
            return voidSale(sale.id);
          }
          return refundSale(sale.id, reason);
        }}
      />
    </section>
  );
}
