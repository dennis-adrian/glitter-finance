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
    try {
      await acceptInvitation(token);
      try {
        await powerSyncControls?.clearLocal();
      } catch (clearError) {
        console.error("[join] clearLocal failed", clearError);
      }
      const supabase = createClient();
      await supabase.auth.refreshSession();
      window.location.assign("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo unir a esta cuenta."
      );
      setJoining(false);
    }
  }

  return (
    <div className="mt-5">
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
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
