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

    // Only acceptInvitation drives the failure UI — it is the step that decides
    // whether the join succeeded.
    try {
      await acceptInvitation(token);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo unir a esta cuenta."
      );
      setJoining(false);
      return;
    }

    // Joined + committed. Local teardown + session refresh are best-effort; a
    // failure here must not appear as a failed join. Redirect regardless so the
    // app reconciles to the new tenant on reload.
    try {
      await powerSyncControls?.clearLocal();
      const supabase = createClient();
      await supabase.auth.refreshSession();
    } catch (cleanupError) {
      console.error("[join] post-accept cleanup failed", cleanupError);
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
