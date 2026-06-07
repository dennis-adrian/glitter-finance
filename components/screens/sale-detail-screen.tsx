import {
  AlertTriangle,
  ChevronRight,
  Info,
  QrCode,
  ReceiptText,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { DetailRow } from "@/components/atoms/detail-row";
import { Header } from "@/components/atoms/header";
import { EmptyState } from "@/components/molecules/empty-state";
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
  voidSale: (saleId: string) => void;
  refundSale: (saleId: string) => void;
};

export function SaleDetailScreen({
  sale,
  sales,
  back,
  voidSale,
  refundSale,
}: SaleDetailScreenProps) {
  if (!sale) {
    return (
      <section className="screen sale-detail-screen">
        <Header
          title="Detalle"
          left={
            <button className="icon-button" onClick={back} aria-label="Volver">
              <ChevronRight className="flip dark" size={24} />
            </button>
          }
        />
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
  const canVoid = canVoidSale(sale, sales);
  const canRefund = canRefundSale(sale, sales);
  const originalSale = sale.refundOfSaleId
    ? sales.find((item) => item.id === sale.refundOfSaleId)
    : null;
  const refundRecord = sales.find((item) => item.refundOfSaleId === sale.id);

  return (
    <section className="screen sale-detail-screen">
      <Header
        title="Detalle de venta"
        left={
          <button className="icon-button" onClick={back} aria-label="Volver">
            <ChevronRight className="flip dark" size={24} />
          </button>
        }
        right={<BrandMark size="small" />}
      />
      <section className="sale-detail-hero">
        <span className="sale-status-chip">{saleStatusLabel(sale)}</span>
        <h2>{saleReferenceLabel(sale)}</h2>
        <strong>{formatBs(net, true)}</strong>
        <p>
          {new Intl.DateTimeFormat("es-BO", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(sale.createdAt))}
        </p>
      </section>
      <section className="panel sale-detail-panel">
        <h2>Registro</h2>
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
          value={new Intl.DateTimeFormat("es-BO", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(sale.createdAt))}
        />
        {sale.clientCreatedAt ? (
          <DetailRow
            label="Hora local"
            value={new Intl.DateTimeFormat("es-BO", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(sale.clientCreatedAt))}
          />
        ) : null}
        <DetailRow label="Registró" value={sale.userName} />
        <DetailRow
          label="Estado"
          value={saleStatusLabel(sale)}
          tone={sale.status === "voided" ? "danger" : "strong"}
        />
        {sale.voidedAt ? (
          <DetailRow
            label="Anulada"
            value={new Intl.DateTimeFormat("es-BO", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(sale.voidedAt))}
            tone="danger"
          />
        ) : null}
      </section>
      <section className="panel sale-detail-panel">
        <h2>Pago</h2>
        <DetailRow
          label="Método"
          value={
            <span className="detail-icon-value">
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
      <section className="panel sale-detail-panel">
        <h2>Productos</h2>
        <div className="sale-line-stack">
          {sale.lines.map((line) => (
            <SaleLineDetail key={line.id} line={line} />
          ))}
        </div>
      </section>
      <section className="panel sale-detail-panel">
        <h2>Totales</h2>
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
        <div className="cost-warning sale-detail-warning">
          <Info size={17} />
          La ganancia es un máximo estimado porque al menos un producto no tiene
          costo registrado.
        </div>
      ) : null}
      <section className="sale-detail-actions">
        <button
          className="secondary-action"
          disabled={!canVoid}
          onClick={() => voidSale(sale.id)}
        >
          <Trash2 size={18} />
          Anular venta
        </button>
        <button
          className="secondary-action"
          disabled={!canRefund}
          onClick={() => refundSale(sale.id)}
        >
          <RotateCcw size={18} />
          Reembolsar venta
        </button>
        {!canVoid && !canRefund ? (
          <p>
            <AlertTriangle size={15} />
            Esta venta queda solo como registro. No hay acciones correctivas
            disponibles.
          </p>
        ) : null}
      </section>
    </section>
  );
}
