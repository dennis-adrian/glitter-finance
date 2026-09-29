"use client";

import { useState, useSyncExternalStore } from "react";
import { signOut } from "@/app/auth/actions";
import { returnToTenant } from "@/app/tenants/actions";
import { unwrapActionResult } from "@/lib/action-result";
import {
  LocalDataPanel,
  LocalDataPanelButton,
} from "@/components/providers/local-data-panel";
import {
  loadDocument,
  refreshSessionForActiveTenant,
  SIGN_OUT_FAILED_MESSAGE,
} from "@/lib/auth/identity-change";
import { formatDateInputInBolivia } from "@/lib/dates";
import { downloadJsonFile } from "@/lib/download-json";
import { describePendingUploads } from "@/lib/powersync/local-data-gate";
import {
  localDataRecoveryActions,
  type LocalDataRecovery,
  type PreviousTenantAccess,
} from "@/lib/powersync/local-data-recovery";
import { describeUploadHold } from "@/lib/powersync/upload-holds";

/** What the panel asks of the provider, which holds the local database. */
export type LocalDataRecoveryControls = {
  /** Reconnects, so the rejected upload is sent again right away. */
  retryUpload: () => Promise<void>;
  /** The unsynced work as JSON, for the user to keep before discarding it. */
  exportUnsyncedWork: () => Promise<string>;
  /** Clears the unsynced work and starts over with the session's identity. */
  discardUnsyncedWork: () => void;
};

const SWITCH_BACK_FAILED_MESSAGE = "No se pudo volver al puesto anterior.";
const EXPORT_FAILED_MESSAGE =
  "No se pudo descargar la copia. Inténtalo de nuevo.";
const RETRY_FAILED_MESSAGE =
  "No se pudo reintentar la subida. Revisa la conexión e inténtalo de nuevo.";
const KEPT_ON_DEVICE = "las operaciones se conservan en este dispositivo";

function drainingMessage(pendingUploadCount: number) {
  return pendingUploadCount === 1
    ? "Subiendo 1 operación pendiente antes de continuar…"
    : `Subiendo ${pendingUploadCount} operaciones pendientes antes de continuar…`;
}

function drainingDetail(
  recovery: Extract<LocalDataRecovery, { kind: "draining" }>,
  input: {
    online: boolean;
    canSwitchBack: boolean;
    previousTenantAccess: PreviousTenantAccess;
  }
) {
  const keepOpen =
    "Mantén la app abierta; se subirán antes de mostrar los datos de esta sesión.";
  if (!recovery.stalled) {
    return recovery.uploadHold
      ? `${describeUploadHold(recovery.uploadHold)} ${keepOpen}`
      : "Este dispositivo tiene operaciones que aún no llegaron a la nube. Mantén la app abierta y conectada a internet; se subirán antes de mostrar los datos de esta sesión.";
  }

  const cause = recovery.uploadHold
    ? describeUploadHold(recovery.uploadHold)
    : !input.online
      ? "Este dispositivo está sin conexión; se subirán cuando vuelva internet."
      : recovery.uploadError
        ? `La nube todavía no las acepta (${recovery.uploadError}); la subida se reintenta sola.`
        : "La subida está tardando más de lo normal; se sigue reintentando.";
  const exits = input.canSwitchBack
    ? `Si no puedes esperar, vuelve al puesto anterior o cierra sesión: ${KEPT_ON_DEVICE}.`
    : `Si no puedes esperar, cierra sesión: ${KEPT_ON_DEVICE}.`;
  return input.previousTenantAccess === "lost"
    ? `${cause} Ya no tienes acceso al puesto anterior. ${exits}`
    : `${cause} ${exits}`;
}

function subscribeToConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline() {
  return useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true
  );
}

/**
 * Shown instead of the app while this device holds unsynced work of another
 * identity than the session's. Every state has a way out that keeps the
 * work: going back to the tenant it belongs to, or signing out (which clears
 * nothing). Only when no such tenant is within reach (access lost, or work
 * nobody can be named for) can the user retry the rejected upload, download
 * a copy of the work and, after confirming, discard it.
 */
export function LocalDataRecoveryPanel({
  layout,
  recovery,
  controls,
}: {
  layout: "page" | "parent";
  recovery: LocalDataRecovery;
  controls: LocalDataRecoveryControls;
}) {
  const online = useOnline();
  const [pending, setPending] = useState<
    "switch-back" | "sign-out" | "retry" | "discard" | null
  >(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [previousTenantAccess, setPreviousTenantAccess] =
    useState<PreviousTenantAccess>("unknown");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const actions = localDataRecoveryActions(recovery, previousTenantAccess);

  /**
   * Runs the server step and loads `destination`, or shows why it failed.
   * `commit` resolves false when there is nowhere to go after all.
   */
  async function run(
    action: "switch-back" | "sign-out",
    commit: () => Promise<boolean>,
    destination: string,
    failureMessage: string
  ) {
    setPending(action);
    setError(null);
    try {
      if (!(await commit())) {
        setPending(null);
        return;
      }
    } catch (commitError) {
      console.error(`[local-data-recovery] ${action} failed`, commitError);
      setError(
        commitError instanceof Error && commitError.message
          ? commitError.message
          : failureMessage
      );
      setPending(null);
      return;
    }
    loadDocument(destination);
  }

  function handleSignOut() {
    void run(
      "sign-out",
      async () => {
        try {
          await signOut();
        } catch (signOutError) {
          throw new Error(SIGN_OUT_FAILED_MESSAGE, { cause: signOutError });
        }
        return true;
      },
      "/login",
      SIGN_OUT_FAILED_MESSAGE
    );
  }

  function handleSwitchBack(tenantId: string) {
    void run(
      "switch-back",
      async () => {
        const result = await unwrapActionResult(
          () => returnToTenant(tenantId),
          SWITCH_BACK_FAILED_MESSAGE
        );
        if (result === "no-access") {
          setPreviousTenantAccess("lost");
          return false;
        }
        await refreshSessionForActiveTenant();
        return true;
      },
      "/",
      SWITCH_BACK_FAILED_MESSAGE
    );
  }

  async function handleDownload() {
    setError(null);
    try {
      downloadJsonFile(
        await controls.exportUnsyncedWork(),
        `operaciones-sin-subir-${formatDateInputInBolivia()}.json`
      );
      setDownloaded(true);
    } catch (exportError) {
      console.error("[local-data-recovery] export failed", exportError);
      setError(EXPORT_FAILED_MESSAGE);
    }
  }

  async function handleRetry() {
    setPending("retry");
    setError(null);
    try {
      await controls.retryUpload();
    } catch (retryError) {
      console.error("[local-data-recovery] retry failed", retryError);
      setError(RETRY_FAILED_MESSAGE);
    } finally {
      setPending(null);
    }
  }

  function handleDiscard() {
    setPending("discard");
    // The provider starts over and replaces this panel.
    controls.discardUnsyncedWork();
  }

  const signOutButton = actions.signOut ? (
    <LocalDataPanelButton
      variant="secondary"
      disabled={busy}
      onClick={handleSignOut}
    >
      {pending === "sign-out" ? "Cerrando sesión…" : "Cerrar sesión"}
    </LocalDataPanelButton>
  ) : null;
  const { switchBackTo } = actions;
  const switchBackButton = switchBackTo ? (
    <LocalDataPanelButton
      disabled={busy}
      onClick={() => handleSwitchBack(switchBackTo)}
    >
      {pending === "switch-back" ? "Volviendo…" : "Volver al puesto anterior"}
    </LocalDataPanelButton>
  ) : null;

  if (recovery.kind === "draining") {
    return (
      <LocalDataPanel
        layout={layout}
        tone="status"
        message={drainingMessage(recovery.pendingUploadCount)}
        detail={
          error ??
          drainingDetail(recovery, {
            online,
            canSwitchBack: switchBackTo !== null,
            previousTenantAccess,
          })
        }
      >
        {switchBackButton}
        {signOutButton}
      </LocalDataPanel>
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
        <LocalDataPanelButton disabled={busy} onClick={handleSignOut}>
          {pending === "sign-out" ? "Cerrando sesión…" : "Cerrar sesión"}
        </LocalDataPanelButton>
      </LocalDataPanel>
    );
  }

  if (actions.discard && confirmingDiscard) {
    return (
      <LocalDataPanel
        layout={layout}
        tone="alert"
        message={
          recovery.pendingUploadCount > 0
            ? `¿Descartar las operaciones sin subir? ${describePendingUploads(
                recovery.pendingUploadCount
              )}`
            : "¿Descartar las operaciones sin subir?"
        }
        detail={
          error ??
          `Se borrarán de este dispositivo y nunca llegarán a la nube. ${
            downloaded
              ? "Guarda la copia que descargaste para registrarlas de nuevo."
              : "Descarga una copia antes para poder registrarlas de nuevo."
          }`
        }
      >
        <LocalDataPanelButton disabled={busy} onClick={handleDiscard}>
          {pending === "discard" ? "Descartando…" : "Descartar y continuar"}
        </LocalDataPanelButton>
        <LocalDataPanelButton
          variant="secondary"
          disabled={busy}
          onClick={() => void handleDownload()}
        >
          Descargar copia
        </LocalDataPanelButton>
        <LocalDataPanelButton
          variant="secondary"
          disabled={busy}
          onClick={() => setConfirmingDiscard(false)}
        >
          Cancelar
        </LocalDataPanelButton>
      </LocalDataPanel>
    );
  }

  if (actions.discard) {
    return (
      <LocalDataPanel
        layout={layout}
        tone="alert"
        message={
          block.reason === "unattributed"
            ? "Este dispositivo tiene operaciones sin subir que la nube rechaza, y no se sabe de qué cuenta son."
            : previousTenantAccess === "lost"
              ? "Ya no tienes acceso al puesto de estas operaciones, y la nube no las acepta."
              : "Hay operaciones tuyas que la nube rechaza, y no hay un puesto al que volver para revisarlas."
        }
        detail={
          error ??
          `${
            recovery.uploadError
              ? `La nube responde: ${recovery.uploadError}. `
              : ""
          }La subida se reintenta mientras la app esté abierta. Si la nube las sigue rechazando, descarga una copia para registrarlas de nuevo y descártalas para continuar. Hasta entonces, ${KEPT_ON_DEVICE}.`
        }
      >
        {actions.retry ? (
          <LocalDataPanelButton
            disabled={busy}
            onClick={() => void handleRetry()}
          >
            {pending === "retry" ? "Reintentando…" : "Reintentar subida"}
          </LocalDataPanelButton>
        ) : null}
        <LocalDataPanelButton
          variant={actions.retry ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => void handleDownload()}
        >
          {downloaded ? "Copia descargada" : "Descargar copia"}
        </LocalDataPanelButton>
        <LocalDataPanelButton
          variant="secondary"
          disabled={busy}
          onClick={() => setConfirmingDiscard(true)}
        >
          Descartar operaciones
        </LocalDataPanelButton>
        {signOutButton}
      </LocalDataPanel>
    );
  }

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
      {switchBackButton}
      {signOutButton}
    </LocalDataPanel>
  );
}
