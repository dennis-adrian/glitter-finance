"use client";

import { useRef, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Sale } from "@/lib/types";
import { useDialogFocusTrap } from "@/lib/use-dialog-focus-trap";
import { MAX_NOTE_LENGTH } from "@/lib/validation";

type SaleAction = "void" | "refund";

type SaleActionDialogProps = {
  sale: Sale | null;
  action: SaleAction | null;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<boolean>;
};

export function SaleActionDialog({
  sale,
  action,
  onClose,
  onConfirm,
}: SaleActionDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  const isOpen = sale !== null && action !== null;
  useDialogFocusTrap(dialogRef, {
    isOpen,
    onClose,
    canClose: () => !pendingRef.current,
  });

  if (!sale || !action) return null;

  const isVoid = action === "void";

  async function confirm() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    const failureMessage = isVoid
      ? "No se pudo anular la venta."
      : "No se pudo registrar el reembolso.";
    try {
      const succeeded = await onConfirm(reason.trim() || undefined);
      if (succeeded) {
        setReason("");
        onClose();
        return;
      }
      setError(failureMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-foreground/35 p-3 sm:items-center sm:justify-center"
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="w-full max-w-[448px] rounded-2xl bg-card p-4 shadow-[var(--shadow)] ring-1 ring-foreground/10"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-action-title"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
              {isVoid ? "Corrección inmediata" : "Reversión de venta"}
            </span>
            <h2 id="sale-action-title" className="mt-1 text-lg font-semibold">
              {isVoid ? "¿Anular esta venta?" : "¿Registrar este reembolso?"}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isPending}
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </Button>
        </div>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {isVoid
            ? "La venta permanecerá en el historial y quedará excluida de los totales."
            : "Se registrará un reembolso completo como una nueva transacción negativa. La venta original permanecerá en el historial."}
        </p>

        {!isVoid ? (
          <label className="mt-4 grid gap-1.5 text-sm font-semibold">
            Motivo{" "}
            <span className="font-normal text-muted-foreground">
              (opcional)
            </span>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej.: Producto devuelto"
              maxLength={MAX_NOTE_LENGTH}
              className="min-h-20 resize-none rounded-xl"
              disabled={isPending}
            />
          </label>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={isPending}
          >
            Volver
          </Button>
          <Button
            type="button"
            size="lg"
            variant={isVoid ? "destructive" : "default"}
            onClick={() => void confirm()}
            disabled={isPending}
          >
            {isVoid ? (
              <Trash2 className="size-[18px]" />
            ) : (
              <RotateCcw className="size-[18px]" />
            )}
            {isPending
              ? "Guardando…"
              : isVoid
                ? "Anular venta"
                : "Registrar reembolso"}
          </Button>
        </div>
      </section>
    </div>
  );
}
