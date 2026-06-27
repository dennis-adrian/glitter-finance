"use client";

import { useState } from "react";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Edit3,
  Info,
  QrCode,
  UserRound,
} from "lucide-react";
import { Header } from "@/components/atoms/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <section className="screen detail-screen">
      <Header
        title="Pago"
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={back}
            aria-label="Volver"
          >
            <ChevronLeft className="size-6" />
          </Button>
        }
      />

      <div className="py-8 text-center">
        <span className="text-sm text-muted-foreground">Monto total</span>
        <strong className="mt-1 mb-1.5 block text-3xl font-bold tabular-nums">
          Cobrar {formatBs(total, true)}
        </strong>
        <small className="text-sm text-muted-foreground">
          {count} productos
        </small>
        {discount ? (
          <p className="mt-2">
            <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
              Descuento aplicado: {formatBs(discount, true)}
            </span>
          </p>
        ) : null}
      </div>

      <section className="mb-7">
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Aplicar descuento</h2>
          <Info className="size-5 text-muted-foreground" />
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {[200, 500, 1000].map((value) => (
            <Button
              key={value}
              type="button"
              variant={discount === value ? "default" : "outline"}
              className="tabular-nums"
              onClick={() => apply(value)}
            >
              {formatBs(value, true)}
            </Button>
          ))}
          <Button
            type="button"
            variant={customOpen ? "default" : "outline"}
            onClick={() => setCustomOpen((open) => !open)}
          >
            <Edit3 />
            Otro
          </Button>
        </div>
        {customOpen ? (
          <div className="mt-2.5 grid grid-cols-[1fr_96px] gap-2">
            <Input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              inputMode="decimal"
              placeholder="Ej. 7 o 10%"
              aria-label="Monto o porcentaje de descuento"
            />
            <Button
              type="button"
              onClick={() => apply(parseCustomDiscount(custom, subtotal))}
            >
              Aplicar
            </Button>
          </div>
        ) : null}
        {discount ? (
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo opcional"
            aria-label="Motivo opcional del descuento"
            className="mt-2.5 h-12 rounded-xl"
          />
        ) : null}
      </section>

      <section className="mb-7">
        <h2 className="mb-3.5 text-xl font-semibold">Método de pago</h2>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            disabled={!count || isSubmitting}
            onClick={() => pay("cash", discount, reason)}
            className="w-full"
          >
            <Banknote className="size-6" />
            <span>{isSubmitting ? "Registrando..." : "Efectivo"}</span>
            <ChevronRight className="size-[22px] justify-self-end" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!count || isSubmitting}
            onClick={() => pay("qr_transfer", discount, reason)}
            className="w-full"
          >
            <QrCode className="size-6" />
            <span>{isSubmitting ? "Registrando..." : "QR"}</span>
            <ChevronRight className="size-[22px] justify-self-end" />
          </Button>
        </div>
      </section>

      <Button
        type="button"
        variant="ghost"
        className="w-full text-primary hover:text-primary"
        disabled
      >
        <ClipboardList />
        Ver detalle de orden
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full text-muted-foreground"
        disabled
      >
        <UserRound />
        Asignar cliente
      </Button>
    </section>
  );
}
