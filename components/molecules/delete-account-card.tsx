"use client";

import { useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Loader2, Trash2 } from "lucide-react";
import { getAccountDeletionPlan } from "@/app/account/actions";
import { ReloadAppButton } from "@/components/molecules/reload-app-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unwrapActionResult } from "@/lib/action-result";
import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  isAccountDeletionConfirmed,
  type AccountDeletionPlan,
} from "@/lib/auth/tenant-owner";
import { useTenantSessionActions } from "@/lib/auth/use-tenant-session-actions";
import { describeLocalDataChangeBlocker } from "@/lib/powersync/local-data-gate";
import type { TenantSummary } from "@/lib/types";

const PLAN_FAILED_MESSAGE =
  "No se pudo revisar qué pasaría con tus puestos. Revisá la conexión y volvé a intentarlo.";

type PlanState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; plan: AccountDeletionPlan };

function names(tenants: TenantSummary[]) {
  return new Intl.ListFormat("es", { type: "conjunction" }).format(
    tenants.map((tenant) => `«${tenant.name}»`)
  );
}

/**
 * Deletes the signed-in user's account after showing what happens to each
 * of their puestos and asking them to type the confirmation word. Like a
 * sign-out it clears this device's data first, so it waits until nothing is
 * left to upload.
 */
export function DeleteAccountCard({
  activeTenantId,
}: {
  activeTenantId: string | null;
}) {
  const { gate, busy, deletingAccount, error, deleteAccount } =
    useTenantSessionActions({
      activeTenantId,
      copy: {
        switchFailed: "No se pudo cambiar de puesto.",
        createFailed: "No se pudo crear el puesto.",
      },
    });
  const [open, setOpen] = useState(false);
  const [planState, setPlanState] = useState<PlanState>({ status: "loading" });
  const [confirmation, setConfirmation] = useState("");
  // Only the latest request's answer counts: reopening the dialog or
  // retrying must not show an older, stale plan.
  const planRequestRef = useRef(0);

  async function loadPlan() {
    const request = ++planRequestRef.current;
    setPlanState({ status: "loading" });
    try {
      const plan = await unwrapActionResult(
        () => getAccountDeletionPlan(),
        PLAN_FAILED_MESSAGE
      );
      if (request !== planRequestRef.current) return;
      setPlanState({ status: "ready", plan });
    } catch (planError) {
      if (request !== planRequestRef.current) return;
      setPlanState({
        status: "error",
        message:
          planError instanceof Error && planError.message
            ? planError.message
            : PLAN_FAILED_MESSAGE,
      });
    }
  }

  function openDialog() {
    setConfirmation("");
    setOpen(true);
    void loadPlan();
  }

  const plan = planState.status === "ready" ? planState.plan : null;
  const blocked = plan !== null && plan.blockers.length > 0;
  const canConfirm =
    plan !== null &&
    !blocked &&
    isAccountDeletionConfirmed(confirmation) &&
    gate.canChange &&
    !busy;

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={openDialog}
        className="grid min-h-16 w-full grid-cols-[42px_1fr] items-center rounded-2xl bg-card px-3.5 text-left ring-1 ring-foreground/10 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="text-destructive">
          <Trash2 size={21} />
        </span>
        <span>
          <strong className="block text-sm font-semibold text-destructive">
            Eliminar mi cuenta
          </strong>
          <small className="block text-xs text-muted-foreground">
            Borra tu usuario y los puestos donde sos el único miembro
          </small>
        </span>
      </button>

      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/35 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="fixed inset-x-3 bottom-3 z-50 mx-auto max-h-[calc(100dvh-1.5rem)] max-w-md overflow-y-auto rounded-3xl bg-card p-5 shadow-[var(--shadow)] ring-1 ring-foreground/10 transition-[opacity,transform] duration-200 outline-none data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:data-ending-style:-translate-y-[48%] sm:data-starting-style:-translate-y-[48%]">
            <span className="mb-3 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
              <Trash2 className="size-5" />
            </span>
            <AlertDialog.Title className="text-lg font-semibold">
              ¿Eliminar tu cuenta?
            </AlertDialog.Title>
            <AlertDialog.Description
              render={<div />}
              className="mt-2 grid gap-2 text-sm leading-6 text-muted-foreground"
            >
              {planState.status === "loading" ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Revisando tus puestos…
                </p>
              ) : planState.status === "error" ? (
                <p className="text-destructive" role="alert">
                  {planState.message}
                </p>
              ) : blocked ? (
                <p>
                  Todavía no podés eliminarla: creaste{" "}
                  {names(planState.plan.blockers)} y{" "}
                  {planState.plan.blockers.length === 1
                    ? "tiene otros miembros"
                    : "tienen otros miembros"}
                  . Quitalos desde Ajustes › Equipo en{" "}
                  {planState.plan.blockers.length === 1
                    ? "ese puesto"
                    : "cada puesto"}{" "}
                  y volvé a intentarlo.
                </p>
              ) : (
                <>
                  {planState.plan.deletes.length > 0 ? (
                    <p>
                      Se eliminan {names(planState.plan.deletes)}, con todos sus
                      productos, ventas, stock y fotos.
                    </p>
                  ) : null}
                  {planState.plan.leaves.length > 0 ? (
                    <p>
                      Salís de {names(planState.plan.leaves)}. Las ventas que
                      registraste ahí se conservan con tu nombre.
                    </p>
                  ) : null}
                  <p>
                    No se puede deshacer. Se cierra tu sesión en todos tus
                    dispositivos, y lo que no se haya subido desde otros
                    dispositivos se pierde.
                  </p>
                </>
              )}
            </AlertDialog.Description>

            {plan && !blocked ? (
              <div className="mt-4 grid gap-2">
                <Label htmlFor="delete-account-confirmation">
                  Escribí {ACCOUNT_DELETION_CONFIRMATION_WORD} para confirmar
                </Label>
                <Input
                  id="delete-account-confirmation"
                  value={confirmation}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                {gate.blocker ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {describeLocalDataChangeBlocker(gate.blocker, {
                      pendingCount: gate.pendingCount,
                      uploadHold: gate.uploadHold,
                      action: "eliminar tu cuenta",
                    })}
                  </p>
                ) : null}
                {gate.blocker === "tenant-changed" ? <ReloadAppButton /> : null}
                {error?.action === "delete-account" ? (
                  <p
                    className="text-xs leading-relaxed text-destructive"
                    role="alert"
                  >
                    {error.message}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <AlertDialog.Close
                render={<Button type="button" variant="outline" size="lg" />}
                disabled={deletingAccount}
              >
                Cancelar
              </AlertDialog.Close>
              {planState.status === "error" ? (
                <Button type="button" size="lg" onClick={() => void loadPlan()}>
                  Reintentar
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  variant="destructive"
                  disabled={!canConfirm}
                  onClick={() => void deleteAccount(confirmation)}
                >
                  {deletingAccount ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {deletingAccount ? "Eliminando…" : "Eliminar"}
                </Button>
              )}
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
