"use client";

import { useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogFocusTrap } from "@/lib/use-dialog-focus-trap";

type DiscardSyncFailureDialogProps = {
  /** What the failed operation was ("Venta", …); null when closed. */
  label: string | null;
  onClose: () => void;
  /** Resolves once discarded; a rejection is shown in the dialog. */
  onConfirm: () => Promise<void>;
};

export function DiscardSyncFailureDialog({
  label,
  onClose,
  onConfirm,
}: DiscardSyncFailureDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  const isOpen = label !== null;
  useDialogFocusTrap(dialogRef, {
    isOpen,
    onClose: close,
    canClose: () => !pendingRef.current,
  });

  function close() {
    setError(null);
    onClose();
  }

  if (label === null) return null;

  async function confirm() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo descartar la operación."
      );
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
        aria-labelledby="discard-sync-failure-title"
        aria-describedby="discard-sync-failure-description"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
              {label}
            </span>
            <h2
              id="discard-sync-failure-title"
              className="mt-1 text-lg font-semibold"
            >
              ¿Descartar esta operación?
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={close}
            disabled={isPending}
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </Button>
        </div>

        <div
          id="discard-sync-failure-description"
          className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground"
        >
          <p>
            La nube rechazó esta operación, y mientras la siga rechazando, lo
            que vino después tampoco puede subirse. Si la descartás, se quita de
            la cola de este dispositivo y sus cambios se deshacen aquí.
          </p>
          <p>
            Sus datos quedan en el diagnóstico hasta que cierres sesión. Si los
            necesitás, copiá el diagnóstico antes.
          </p>
        </div>

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
            onClick={close}
            disabled={isPending}
          >
            Volver
          </Button>
          <Button
            type="button"
            size="lg"
            variant="destructive"
            onClick={() => void confirm()}
            disabled={isPending}
          >
            <Trash2 className="size-[18px]" />
            {isPending ? "Descartando…" : "Descartar"}
          </Button>
        </div>
      </section>
    </div>
  );
}
