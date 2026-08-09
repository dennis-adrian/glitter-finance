"use client";

import { useState } from "react";
import { acceptInvitation } from "@/app/invitations/actions";
import { Button } from "@/components/ui/button";
import { usePowerSyncControls } from "@/components/providers/powersync-provider";
import { createClient } from "@/lib/supabase/client";

type JoinTenantFormProps = {
  token: string;
};

export function JoinTenantForm({ token }: JoinTenantFormProps) {
  const powerSyncControls = usePowerSyncControls();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (joining) {
      return;
    }
    setJoining(true);
    setError(null);

    // Purge the currently active tenant before committing the account change.
    // A failure leaves both the session and invitation untouched so retrying is
    // safe; continuing would risk showing the prior tenant after reload.
    try {
      if (!powerSyncControls) {
        throw new Error("La limpieza local aún no está disponible.");
      }
      await powerSyncControls.teardownForTenantChange();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} Reintenta la limpieza segura antes de unirte.`
          : "No se pudieron limpiar los datos locales. Reintenta antes de unirte."
      );
      setJoining(false);
      return;
    }

    try {
      await acceptInvitation(token);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo unir a esta cuenta."
      );
      setJoining(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        console.error("[join] refreshSession failed", error);
      }
    } catch (error) {
      console.error("[join] refreshSession failed", error);
    }
    window.location.assign("/");
  }

  return (
    <div className="mt-5">
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
        disabled={joining}
      >
        {joining ? "Uniéndote…" : "Unirme"}
      </Button>
    </div>
  );
}
