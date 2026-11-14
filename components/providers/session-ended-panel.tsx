"use client";

import { useState } from "react";
import {
  LocalDataPanel,
  LocalDataPanelButton,
} from "@/components/providers/local-data-panel";
import { loadDocument } from "@/lib/auth/identity-change";
import {
  discardAlternative,
  sessionEndedCopy,
  sessionEndedWithWork,
  type SessionEndedWork,
} from "@/lib/auth/session-end";
import { formatDateInputInBolivia } from "@/lib/dates";
import { downloadJsonFile } from "@/lib/download-json";

const EXPORT_FAILED_MESSAGE =
  "No se pudo descargar la copia. Intentalo de nuevo.";
const DISCARD_FAILED_MESSAGE =
  "No se pudieron descartar las operaciones. Intentalo de nuevo; mientras tanto siguen en este dispositivo.";

/** What the panel asks of the provider, which holds the local database. */
export type SessionEndedControls = {
  /** The unsynced work as JSON, for the user to keep. */
  exportUnsyncedWork: () => Promise<string>;
  /** Clears the local data, unsynced work included. */
  discardUnsyncedWork: () => Promise<void>;
  /**
   * Goes back to the app without a session. What is recorded stays queued
   * and uploads once the same account signs in again; the panel comes back
   * at the next session check.
   */
  continueWithoutSession: () => void;
};

/**
 * Shown instead of the app once the session ended on its own
 * (lib/auth/session-end.ts). Signing in again keeps the work: the same
 * account uploads it. Downloading a copy and discarding it is the way out
 * when the account no longer exists, since another account's sign-in keeps
 * it on the device and never uploads it.
 */
export function SessionEndedPanel({
  layout,
  work,
  controls,
}: {
  layout: "page" | "parent";
  work: SessionEndedWork;
  controls: SessionEndedControls;
}) {
  const [pending, setPending] = useState<"download" | "discard" | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = pending !== null;
  const { message, detail } = sessionEndedCopy(work);
  const signIn = () => loadDocument("/login");

  async function handleDownload() {
    setPending("download");
    setError(null);
    try {
      downloadJsonFile(
        await controls.exportUnsyncedWork(),
        `operaciones-sin-subir-${formatDateInputInBolivia()}.json`
      );
      setDownloaded(true);
    } catch (downloadError) {
      console.error("[session-ended] export failed", downloadError);
      setError(EXPORT_FAILED_MESSAGE);
    } finally {
      setPending(null);
    }
  }

  async function handleDiscard() {
    setPending("discard");
    setError(null);
    try {
      await controls.discardUnsyncedWork();
      signIn();
    } catch (discardError) {
      console.error("[session-ended] discard failed", discardError);
      setError(DISCARD_FAILED_MESSAGE);
      setPending(null);
    }
  }

  if (!sessionEndedWithWork(work)) {
    return (
      <LocalDataPanel
        layout={layout}
        tone="alert"
        message={message}
        detail={detail}
      >
        <LocalDataPanelButton onClick={signIn}>
          Iniciar sesión
        </LocalDataPanelButton>
        <LocalDataPanelButton
          variant="secondary"
          onClick={controls.continueWithoutSession}
        >
          Seguir registrando
        </LocalDataPanelButton>
      </LocalDataPanel>
    );
  }

  if (confirmingDiscard) {
    return (
      <LocalDataPanel
        layout={layout}
        tone="alert"
        message="¿Descartar las operaciones sin subir?"
        detail={
          error ??
          `Se borrarán de este dispositivo y nunca llegarán a la nube. ${
            downloaded
              ? "Guardá la copia que descargaste para registrarlas de nuevo."
              : "Descargá una copia antes para poder registrarlas de nuevo."
          } ${discardAlternative(work)}`
        }
      >
        <LocalDataPanelButton disabled={busy} onClick={handleDiscard}>
          {pending === "discard"
            ? "Descartando…"
            : "Descartar e ir al inicio de sesión"}
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

  return (
    <LocalDataPanel
      layout={layout}
      tone="alert"
      message={message}
      detail={error ?? detail}
    >
      <LocalDataPanelButton disabled={busy} onClick={signIn}>
        Iniciar sesión
      </LocalDataPanelButton>
      <LocalDataPanelButton
        variant="secondary"
        disabled={busy}
        onClick={() => void handleDownload()}
      >
        {pending === "download"
          ? "Descargando…"
          : downloaded
            ? "Descargar de nuevo"
            : "Descargar copia"}
      </LocalDataPanelButton>
      <LocalDataPanelButton
        variant="secondary"
        disabled={busy}
        onClick={() => setConfirmingDiscard(true)}
      >
        Descartar…
      </LocalDataPanelButton>
      <LocalDataPanelButton
        variant="secondary"
        disabled={busy}
        onClick={controls.continueWithoutSession}
      >
        Seguir registrando
      </LocalDataPanelButton>
    </LocalDataPanel>
  );
}
