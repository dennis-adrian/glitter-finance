"use client";

import { useId, useState } from "react";
import {
  Banknote,
  ChevronDown,
  Edit3,
  Info,
  QrCode,
  ShoppingBag,
} from "lucide-react";
import { ProductArt } from "@/components/atoms/product-art";
import { EmptyState } from "@/components/molecules/empty-state";
import { ScreenHeader } from "@/components/molecules/screen-header";
import { SegmentedControl } from "@/components/molecules/segmented-control";
import type { CartDetail } from "@/components/organisms/order-panel";
import { Screen } from "@/components/templates/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clampDiscount,
  formatBs,
  parseBolivianos,
  parseDiscountInput,
} from "@/lib/money";
import { countLabel } from "@/lib/plural";
import {
  isWithinSaleLimit,
  priceLine,
  saleTotalCents,
} from "@/lib/sales/pricing";
import type { PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MAX_NOTE_LENGTH } from "@/lib/validation";
import {
  evaluateCashTender,
  isDiscountPresetPressed,
  suggestCashAmounts,
} from "@/components/screens/checkout-screen.helpers";

export type CheckoutPayment = {
  method: PaymentMethod;
  discountCents: number;
  discountReason?: string;
  /** Cash handed over; null when not entered (treated as exact). */
  receivedCents: number | null;
};

export type CheckoutScreenProps = {
  lines: CartDetail[];
  /** Sum of the line totals (cartSubtotalCents). */
  subtotal: number;
  count: number;
  back: () => void;
  pay: (payment: CheckoutPayment) => void | Promise<void>;
  isSubmitting?: boolean;
};

const DISCOUNT_PRESETS_CENTS = [200, 500, 1000];

function priceCartLine(line: CartDetail) {
  return priceLine({
    priceCents: line.product.priceCents,
    quantity: line.quantity,
    lineDiscountCents: line.lineDiscountCents,
  });
}

/**
 * Checkout: review the order, apply a sale discount, pick a payment method,
 * and (for cash) enter the amount received to see the change. Nothing is
 * recorded until the seller confirms with the main button.
 */
export function CheckoutScreen({
  lines,
  subtotal,
  count,
  back,
  pay,
  isSubmitting = false,
}: CheckoutScreenProps) {
  const [discount, setDiscount] = useState(0);
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const customErrorId = useId();
  // Cash is the most common payment at fairs, so it starts selected.
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [received, setReceived] = useState("");
  const [showLines, setShowLines] = useState(false);
  const receivedErrorId = useId();
  const total = saleTotalCents(subtotal, discount);
  // Never offer to charge an amount that cannot be recorded as a sale.
  const totalError =
    !Number.isSafeInteger(total) || total < 0
      ? "No se pudo calcular el total. Volvé al pedido y revisá los descuentos."
      : !isWithinSaleLimit(subtotal)
        ? "El total supera el máximo que se puede registrar en una venta."
        : null;
  // Blank means exact; anything typed that is not an amount blocks the sale
  // instead of silently counting as exact.
  const receivedCents = received.trim() ? parseBolivianos(received) : null;
  const receivedError =
    received.trim() && receivedCents == null
      ? "Escribí el monto recibido como 50 o 50,50."
      : null;
  const tender = evaluateCashTender(total, receivedCents);
  const cashSuggestions = totalError ? [] : suggestCashAmounts(total);

  function applyDiscount(value: number) {
    const next = clampDiscount(value, subtotal);
    setDiscount(next);
    if (next === 0) setReason("");
  }

  function applyCustom() {
    const value = parseDiscountInput(custom, subtotal);
    if (value == null) {
      setCustomError("Escribí un monto (7 o 7,50) o un porcentaje (10%).");
      return;
    }
    setCustomError(null);
    applyDiscount(value);
  }

  if (!lines.length) {
    return (
      <Screen
        width="narrow"
        header={<ScreenHeader title="Cobrar" onBack={back} />}
      >
        <EmptyState
          icon={<ShoppingBag size={46} />}
          title="No hay nada para cobrar"
          body="Agregá productos al pedido para registrar una venta."
          action={
            <Button size="lg" onClick={back}>
              Volver a vender
            </Button>
          }
        />
      </Screen>
    );
  }

  const cashShort = method === "cash" && tender.state === "short";
  const cashInvalid = method === "cash" && receivedError != null;
  const canSubmit =
    !cashShort && !cashInvalid && totalError == null && !isSubmitting;
  const totalLabel = totalError ? "—" : formatBs(total, true);
  const submitLabel = isSubmitting
    ? "Registrando…"
    : totalError
      ? "Registrar venta"
      : cashShort
        ? `Faltan ${formatBs(tender.missingCents, true)}`
        : `Registrar venta · ${formatBs(total, true)}`;

  return (
    <Screen
      width="medium"
      header={
        <ScreenHeader
          title="Cobrar"
          onBack={back}
          backLabel="Volver al pedido"
        />
      }
      footer={
        <div className="flex items-center gap-4">
          <div className="hidden min-w-0 flex-1 md:block">
            <span className="block text-sm text-muted-foreground">
              Total a cobrar
            </span>
            <strong className="font-heading text-2xl font-extrabold tabular-nums">
              {totalLabel}
            </strong>
          </div>
          <Button
            type="button"
            size="lg"
            disabled={!canSubmit}
            onClick={() =>
              void pay({
                method,
                discountCents: discount,
                discountReason: reason.trim() || undefined,
                receivedCents: method === "cash" ? receivedCents : null,
              })
            }
            className="w-full shadow-lg shadow-primary/20 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none md:w-auto md:min-w-80"
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-8">
        {/* Order summary */}
        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <span className="text-sm text-muted-foreground">Total a cobrar</span>
          <strong className="mt-1 block font-heading text-4xl leading-none font-extrabold tabular-nums">
            {totalLabel}
          </strong>
          {totalError ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {totalError}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            {countLabel(count, "producto", "productos")}
            {discount ? (
              <span className="ml-2 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 font-bold text-primary">
                −{formatBs(discount, true)} de descuento
              </span>
            ) : null}
          </p>

          <button
            type="button"
            onClick={() => setShowLines((open) => !open)}
            aria-expanded={showLines}
            className="mt-4 flex min-h-11 w-full items-center justify-between gap-2 border-t border-border pt-3 text-left text-sm font-bold text-primary lg:hidden"
          >
            {showLines ? "Ocultar detalle" : "Ver detalle del pedido"}
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                showLines && "rotate-180"
              )}
            />
          </button>

          <div
            className={cn(
              "mt-3 border-t border-border pt-1 lg:mt-5 lg:block",
              showLines ? "block" : "hidden"
            )}
          >
            <ul className="grid">
              {lines.map((line) => {
                const priced = priceCartLine(line);
                return (
                  <li
                    key={line.productId}
                    className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
                  >
                    <ProductArt product={line.product} compact />
                    <span className="min-w-0 flex-1">
                      <strong className="line-clamp-2 text-sm font-semibold">
                        {line.product.name}
                      </strong>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {line.quantity} ×{" "}
                        {formatBs(line.product.priceCents, true)}
                        {priced.discountCents
                          ? ` · −${formatBs(priced.discountCents, true)}`
                          : ""}
                      </span>
                    </span>
                    <b className="text-sm tabular-nums">
                      {formatBs(priced.totalCents, true)}
                    </b>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-2 grid gap-1.5 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatBs(subtotal, true)}</dd>
              </div>
              {discount ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Descuento</dt>
                  <dd className="text-primary tabular-nums">
                    −{formatBs(discount, true)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums">{totalLabel}</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="grid gap-6">
          {/* Discount */}
          <section aria-labelledby="checkout-discount">
            <h2 id="checkout-discount" className="mb-3 text-base font-bold">
              Descuento
            </h2>
            <div className="grid grid-cols-4 gap-2">
              {DISCOUNT_PRESETS_CENTS.map((value) => {
                const pressed = isDiscountPresetPressed(
                  discount,
                  value,
                  customOpen
                );
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={pressed ? "default" : "outline"}
                    aria-pressed={pressed}
                    className="h-10 tabular-nums"
                    onClick={() => {
                      setCustomOpen(false);
                      applyDiscount(pressed ? 0 : value);
                    }}
                  >
                    {formatBs(value, true)}
                  </Button>
                );
              })}
              <Button
                type="button"
                size="sm"
                variant={customOpen ? "default" : "outline"}
                aria-expanded={customOpen}
                className="h-10"
                onClick={() => {
                  setCustomError(null);
                  setCustomOpen((open) => !open);
                }}
              >
                <Edit3 />
                Otro
              </Button>
            </div>
            {customOpen ? (
              <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Input
                  value={custom}
                  onChange={(event) => {
                    setCustom(event.target.value);
                    setCustomError(null);
                  }}
                  inputMode="decimal"
                  placeholder="Ej. 7 o 10%"
                  aria-label="Monto o porcentaje de descuento"
                  aria-invalid={customError ? true : undefined}
                  aria-describedby={customError ? customErrorId : undefined}
                  autoFocus
                />
                <Button type="button" onClick={applyCustom}>
                  Aplicar
                </Button>
              </div>
            ) : null}
            {customOpen && customError ? (
              <p id={customErrorId} className="mt-1.5 text-sm text-destructive">
                {customError}
              </p>
            ) : null}
            {discount ? (
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Motivo del descuento (opcional)"
                aria-label="Motivo del descuento"
                maxLength={MAX_NOTE_LENGTH}
                className="mt-2.5"
              />
            ) : null}
          </section>

          {/* Payment method */}
          <section aria-labelledby="checkout-method">
            <h2 id="checkout-method" className="mb-3 text-base font-bold">
              ¿Cómo te pagan?
            </h2>
            <SegmentedControl<PaymentMethod>
              aria-label="Método de pago"
              value={method}
              onChange={setMethod}
              options={[
                { value: "cash", label: "Efectivo", icon: <Banknote /> },
                { value: "qr_transfer", label: "QR", icon: <QrCode /> },
              ]}
            />

            {method === "cash" ? (
              <div className="mt-4 grid gap-3">
                <p className="text-sm font-semibold">Monto recibido</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={received.trim() ? "outline" : "default"}
                    aria-pressed={!received.trim()}
                    className="h-10"
                    onClick={() => setReceived("")}
                  >
                    Exacto
                  </Button>
                  {cashSuggestions.map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      size="sm"
                      variant={receivedCents === amount ? "default" : "outline"}
                      aria-pressed={receivedCents === amount}
                      className="h-10 tabular-nums"
                      onClick={() => setReceived(String(amount / 100))}
                    >
                      {formatBs(amount, true)}
                    </Button>
                  ))}
                </div>
                <div className="relative">
                  <Input
                    value={received}
                    onChange={(event) => setReceived(event.target.value)}
                    inputMode="decimal"
                    placeholder="Otro monto"
                    aria-label="Monto recibido en efectivo"
                    aria-invalid={cashShort || cashInvalid || undefined}
                    aria-describedby={
                      receivedError ? receivedErrorId : undefined
                    }
                    className="pr-12"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted-foreground">
                    Bs
                  </span>
                </div>
                {receivedError ? (
                  <p
                    id={receivedErrorId}
                    className="-mt-1 text-sm text-destructive"
                  >
                    {receivedError}
                  </p>
                ) : (
                  <div
                    className={cn(
                      "flex items-center justify-between rounded-2xl px-4 py-3",
                      tender.state === "short"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10 text-primary"
                    )}
                    role="status"
                  >
                    <span className="text-sm font-semibold">
                      {tender.state === "short" ? "Falta" : "Cambio"}
                    </span>
                    <strong className="font-heading text-2xl font-extrabold tabular-nums">
                      {formatBs(
                        tender.state === "short"
                          ? tender.missingCents
                          : tender.state === "change"
                            ? tender.changeCents
                            : 0,
                        true
                      )}
                    </strong>
                  </div>
                )}
              </div>
            ) : null}

            {method === "qr_transfer" ? (
              <p className="mt-4 flex gap-2 rounded-2xl bg-muted p-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                Confirmá en tu app del banco que la transferencia llegó antes de
                registrar la venta.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </Screen>
  );
}
