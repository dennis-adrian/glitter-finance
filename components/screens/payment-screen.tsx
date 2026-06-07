"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  ChevronRight,
  ClipboardList,
  Edit3,
  Info,
  QrCode,
  UserRound,
  Wallet,
} from "lucide-react";
import { Header } from "@/components/atoms/header";
import { clampDiscount, formatBs } from "@/lib/money";
import type { PaymentMethod } from "@/lib/types";
import { parseCustomDiscount } from "@/components/screens/payment-screen.helpers";

type PaymentScreenProps = {
  subtotal: number;
  count: number;
  back: () => void;
  pay: (
    method: PaymentMethod,
    discount: number,
    reason?: string
  ) => void | Promise<void>;
  isSubmitting?: boolean;
};

export function PaymentScreen({
  subtotal,
  count,
  back,
  pay,
  isSubmitting = false,
}: PaymentScreenProps) {
  const [discount, setDiscount] = useState(0);
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const total = Math.max(0, subtotal - discount);

  function apply(value: number) {
    const next = clampDiscount(value, subtotal);
    setDiscount(next);
    if (next === 0) setReason("");
  }

  return (
    <section className="screen payment-screen">
      <Header
        title="Pago"
        left={
          <button className="icon-button" onClick={back} aria-label="Volver">
            <ChevronRight className="flip dark" size={24} />
          </button>
        }
      />
      <div className="payment-total">
        <span>Monto total</span>
        <strong>Cobrar {formatBs(total, true)}</strong>
        <small>{count} productos</small>
        {discount ? (
          <em>Descuento aplicado: {formatBs(discount, true)}</em>
        ) : null}
      </div>
      <section className="payment-block">
        <div className="section-title">
          <h2>Aplicar descuento</h2>
          <Info size={20} />
        </div>
        <div className="discount-row">
          {[200, 500, 1000].map((value) => (
            <button
              key={value}
              className={clsx(discount === value && "selected")}
              onClick={() => apply(value)}
            >
              {formatBs(value, true)}
            </button>
          ))}
          <button onClick={() => setCustomOpen((open) => !open)}>
            <Edit3 size={16} />
            Otro
          </button>
        </div>
        {customOpen ? (
          <div className="custom-discount">
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              inputMode="decimal"
              placeholder="Ej. 7 o 10%"
            />
            <button
              onClick={() => apply(parseCustomDiscount(custom, subtotal))}
            >
              Aplicar
            </button>
          </div>
        ) : null}
        {discount ? (
          <div className="discount-reason">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Motivo opcional"
            />
          </div>
        ) : null}
      </section>
      <section className="payment-block">
        <h2>Método de pago</h2>
        <button
          className="payment-method cash"
          disabled={!count || isSubmitting}
          onClick={() => pay("cash", discount, reason)}
        >
          <Wallet size={25} />
          <span>{isSubmitting ? "Registrando..." : "Efectivo"}</span>
          <ChevronRight size={22} />
        </button>
        <button
          className="payment-method qr"
          disabled={!count || isSubmitting}
          onClick={() => pay("qr_transfer", discount, reason)}
        >
          <QrCode size={25} />
          <span>{isSubmitting ? "Registrando..." : "QR"}</span>
          <ChevronRight size={22} />
        </button>
      </section>
      <button className="ghost-link">
        <ClipboardList size={19} />
        Ver detalle de orden
      </button>
      <button className="ghost-link muted">
        <UserRound size={19} />
        Asignar cliente
      </button>
    </section>
  );
}
