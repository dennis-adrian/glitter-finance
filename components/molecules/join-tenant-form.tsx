"use client";

import { useState } from "react";
import { acceptInvitation } from "@/app/invitations/actions";
import { Button } from "@/components/ui/button";
import { usePowerSyncControls } from "@/components/providers/powersync-provider";
import { unwrapActionResult } from "@/lib/action-result";
import {
  changeIdentityAfterLocalTeardown,
  LOCAL_TEARDOWN_UNAVAILABLE_MESSAGE,
  refreshSessionForActiveTenant,
} from "@/lib/auth/identity-change";
import {
  pendingUploadsBlockerMessage,
  type LocalDataChangeBlocker,
} from "@/lib/powersync/local-data-gate";
import { isUnsyncedLocalDataRefusal } from "@/lib/powersync/local-data-teardown";
import { useLocalDataChangeGate } from "@/lib/powersync/use-local-data-change-gate";

type JoinTenantFormProps = {
  token: string;
};

function describeBlocker(
  blocker: LocalDataChangeBlocker,
  pendingCount: number
) {
  switch (blocker) {
    case "sync-failures":
      return "Hay operaciones que no llegaron a la nube. Abre Diagnósticos en Ajustes antes de unirte.";
    case "pending-uploads":
      return pendingUploadsBlockerMessage(pendingCount, "unirte");
    case "not-synced":
      return "Espera a que termine la sincronización antes de unirte.";
  }
}

export function JoinTenantForm({ token }: JoinTenantFormProps) {
  const powerSyncControls = usePowerSyncControls();
  const gate = useLocalDataChangeGate();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (joining || !gate.canChange) {
      return;
    }
    setJoining(true);
    setError(null);

    // Purge the currently active tenant before committing the account change.
    // A failure leaves both the session and invitation untouched so retrying is
    // safe; continuing would risk showing the prior tenant after reload.
    try {
      if (!powerSyncControls) {
        throw new Error(LOCAL_TEARDOWN_UNAVAILABLE_MESSAGE);
      }
      const navigating = await changeIdentityAfterLocalTeardown({
        teardown: powerSyncControls.teardownForTenantChange,
        commit: async () => {
          await unwrapActionResult(
            () => acceptInvitation(token),
            "No se pudo unir a esta cuenta."
          );
          await refreshSessionForActiveTenant();
        },
        destination: "/",
        failureMessage: "No se pudo unir a esta cuenta.",
        // This form is unmounted once the teardown succeeded.
        reportFailure: powerSyncControls.reportIdentityChangeFailure,
      });
      if (!navigating) {
        setJoining(false);
      }
    } catch (err) {
      setError(
        isUnsyncedLocalDataRefusal(err)
          ? err.message
          : err instanceof Error
            ? `${err.message} Reintenta la limpieza segura antes de unirte.`
            : "No se pudieron limpiar los datos locales. Reintenta antes de unirte."
      );
      setJoining(false);
    }
  }

  return (
    <div className="mt-5">
      {gate.blocker ? (
        <p
          role="status"
          className={
            gate.blocker === "sync-failures"
              ? "mb-3 text-sm text-destructive"
              : "mb-3 text-sm text-muted-foreground"
          }
        >
          {describeBlocker(gate.blocker, gate.pendingCount)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="w-full rounded-2xl"
        onClick={() => void handleJoin()}
        disabled={joining || !gate.canChange}
      >
        {joining ? "Uniéndote…" : "Unirme"}
      </Button>
    </div>
  );
}
