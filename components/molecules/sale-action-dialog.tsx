"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Sale } from "@/lib/types";

type SaleAction = "void" | "refund";

type SaleActionDialogProps = {
  sale: Sale | null;
  action: SaleAction | null;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<boolean>;
};

/**
 * Confirms voiding or refunding a sale. Built on the same AlertDialog as
 * ConfirmDialog (focus trap, Escape, bottom sheet on phones); it can't be
 * dismissed while the mutation is in flight.
 */
export function SaleActionDialog({
  sale,
  action,
  onClose,
  onConfirm,
}: SaleActionDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const isOpen = sale !== null && action !== null;
  const isVoid = action === "void";

  async function confirm() {
    if (isPending) return;
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
      setIsPending(false);
    }
  }

  return (
    <AlertDialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/35 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed inset-x-3 bottom-[calc(0.75rem+var(--keyboard-inset,0px))] z-50 mx-auto max-h-[calc(var(--app-height,100dvh)-1.5rem)] max-w-md overflow-y-auto rounded-3xl bg-card p-5 shadow-[var(--shadow)] ring-1 ring-foreground/10 transition-[opacity,transform] duration-200 outline-none data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:data-ending-style:-translate-y-[48%] sm:data-starting-style:-translate-y-[48%]">
          <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {isVoid ? "Corrección inmediata" : "Reversión de venta"}
          </span>
          <AlertDialog.Title className="mt-1 text-lg font-semibold">
            {isVoid ? "¿Anular esta venta?" : "¿Registrar este reembolso?"}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {isVoid
              ? "La venta queda en el historial y deja de contar en los totales."
              : "Se registra un reembolso completo como una nueva transacción negativa. La venta original queda en el historial."}
          </AlertDialog.Description>

          {!isVoid ? (
            <label className="mt-4 grid gap-1.5 text-sm font-semibold">
              <span>
                Motivo{" "}
                <span className="font-normal text-muted-foreground">
                  (opcional)
                </span>
              </span>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej.: Producto devuelto"
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
            <AlertDialog.Close
              disabled={isPending}
              render={<Button type="button" variant="outline" size="lg" />}
            >
              Volver
            </AlertDialog.Close>
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
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
