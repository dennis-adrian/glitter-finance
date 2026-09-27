"use client";

import type { ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  tone?: "default" | "destructive";
  icon?: ReactNode;
};

/**
 * Confirmation for actions that lose data (discard edits, archive). Bottom
 * sheet on phones, centered dialog from `sm`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  tone = "default",
  icon,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/35 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-3xl bg-card p-5 shadow-[var(--shadow)] ring-1 ring-foreground/10 transition-[opacity,transform] duration-200 outline-none data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:data-ending-style:-translate-y-[48%] sm:data-starting-style:-translate-y-[48%]">
          {icon ? (
            <span
              className={
                tone === "destructive"
                  ? "mb-3 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive"
                  : "mb-3 grid size-11 place-items-center rounded-full bg-primary/10 text-primary"
              }
            >
              {icon}
            </span>
          ) : null}
          <AlertDialog.Title className="text-lg font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <AlertDialog.Close
              render={<Button type="button" variant="outline" size="lg" />}
            >
              {cancelLabel}
            </AlertDialog.Close>
            <Button
              type="button"
              size="lg"
              variant={tone === "destructive" ? "destructive" : "default"}
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
