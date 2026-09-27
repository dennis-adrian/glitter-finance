"use client";

import { useState } from "react";
import { signOut } from "@/app/auth/actions";
import { switchTenant } from "@/app/tenants/actions";
import {
  LocalDataPanel,
  LocalDataPanelButton,
} from "@/components/providers/local-data-panel";
import {
  loadDocument,
  refreshSessionForActiveTenant,
  SIGN_OUT_FAILED_MESSAGE,
} from "@/lib/auth/identity-change";
import type { IdentityMismatchBlock } from "@/lib/powersync/identity-mismatch";

export type LocalDataRecovery =
  | { kind: "draining"; pendingUploadCount: number | null }
  | { kind: "blocked"; block: IdentityMismatchBlock };

function drainingMessage(pendingUploadCount: number | null) {
  if (pendingUploadCount === 1) {
    return "Subiendo 1 operación pendiente antes de continuar…";
  }
  return pendingUploadCount
    ? `Subiendo ${pendingUploadCount} operaciones pendientes antes de continuar…`
    : "Subiendo las operaciones pendientes antes de continuar…";
}

/**
 * Shown instead of the app while this device holds unsynced work of another
 * identity than the session's. Nothing here clears local data: the device
 * either uploads that work first or sends the user back to the identity that
 * can upload it.
 */
export function LocalDataRecoveryPanel({
  layout,
  recovery,
}: {
  layout: "page" | "parent";
  recovery: LocalDataRecovery;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    commit: () => Promise<void>,
    destination: string,
    failureMessage: string
  ) {
    setBusy(true);
    setError(null);
    try {
      await commit();
    } catch (commitError) {
      console.error("[local-data-recovery] action failed", commitError);
      setError(
        commitError instanceof Error && commitError.message
          ? commitError.message
          : failureMessage
      );
      setBusy(false);
      return;
    }
    loadDocument(destination);
  }

  if (recovery.kind === "draining") {
    return (
      <LocalDataPanel
        layout={layout}
        tone="status"
        message={drainingMessage(recovery.pendingUploadCount)}
        detail="Este dispositivo tiene operaciones que aún no llegaron a la nube. Mantén la app abierta y conectada a internet; se subirán antes de mostrar los datos de esta sesión."
      />
    );
  }

  const { block } = recovery;
  if (block.reason === "other-account") {
    return (
      <LocalDataPanel
        layout={layout}
        tone="alert"
        message={
          block.accountEmail
            ? `Este dispositivo tiene operaciones sin subir de la cuenta ${block.accountEmail}.`
            : "Este dispositivo tiene operaciones sin subir de otra cuenta."
        }
        detail={
          error ??
          "Para no perderlas, cierra esta sesión y vuelve a entrar con esa cuenta. Se subirán en cuanto haya conexión."
        }
      >
        <LocalDataPanelButton
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                try {
                  await signOut();
                } catch (signOutError) {
                  throw new Error(SIGN_OUT_FAILED_MESSAGE, {
                    cause: signOutError,
                  });
                }
              },
              "/login",
              SIGN_OUT_FAILED_MESSAGE
            )
          }
        >
          {busy ? "Cerrando sesión…" : "Cerrar sesión"}
        </LocalDataPanelButton>
      </LocalDataPanel>
    );
  }

  const { previousTenantId } = block;
  return (
    <LocalDataPanel
      layout={layout}
      tone="alert"
      message="Hay operaciones de tu puesto anterior que no llegaron a la nube."
      detail={
        error ??
        "Para no perderlas, vuelve a ese puesto y revisa Diagnósticos en Ajustes antes de cambiar."
      }
    >
      {previousTenantId ? (
        <LocalDataPanelButton
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                await switchTenant(previousTenantId);
                await refreshSessionForActiveTenant();
              },
              "/",
              "No se pudo volver al puesto anterior."
            )
          }
        >
          {busy ? "Volviendo…" : "Volver al puesto anterior"}
        </LocalDataPanelButton>
      ) : null}
    </LocalDataPanel>
  );
}
