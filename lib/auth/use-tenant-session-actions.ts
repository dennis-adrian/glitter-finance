"use client";

import { useState } from "react";
import { toast } from "sonner";
import { signOut as signOutOnServer } from "@/app/auth/actions";
import { createTenant, switchTenant } from "@/app/tenants/actions";
import { usePowerSyncControls } from "@/components/providers/powersync-provider";
import { changeIdentityAfterLocalTeardown } from "@/lib/auth/identity-change";
import { isUnsyncedLocalDataRefusal } from "@/lib/powersync/local-data-teardown";
import { useLocalDataChangeGate } from "@/lib/powersync/use-local-data-change-gate";
import { createClient } from "@/lib/supabase/client";

export const LOCAL_TEARDOWN_UNAVAILABLE_MESSAGE =
  "La limpieza local aún no está disponible.";
export const SESSION_REFRESH_FAILED_MESSAGE =
  "La sesión no se actualizó. Cierra sesión y vuelve a entrar, o recarga la página.";
const SIGN_OUT_FAILED_MESSAGE =
  "No se pudo cerrar la sesión. Revisa tu conexión y vuelve a intentarlo.";

/** The new tenant claim only reaches the browser with a refreshed JWT. */
export async function refreshSessionForActiveTenant() {
  let failure: unknown = null;
  try {
    const { error } = await createClient().auth.refreshSession();
    failure = error;
  } catch (error) {
    failure = error;
  }
  if (failure) {
    console.error("[tenant-change] refreshSession failed", failure);
    throw new Error(SESSION_REFRESH_FAILED_MESSAGE, { cause: failure });
  }
}

/** Screen wording, so each screen keeps its own term for a tenant. */
export type TenantSessionCopy = {
  switchFailed: string;
  createFailed: string;
};

export type TenantSessionAction = "switch" | "create" | "sign-out";

/**
 * Switching, creating a tenant and signing out, shared by More and Settings.
 * All three clear the local data, so they share one gate and one order:
 * refuse while unsynced, tear down, run the server action, reload.
 */
export function useTenantSessionActions({
  activeTenantId,
  copy,
}: {
  activeTenantId: string | null;
  copy: TenantSessionCopy;
}) {
  const controls = usePowerSyncControls();
  const gate = useLocalDataChangeGate();
  const [switchingTenantId, setSwitchingTenantId] = useState<string | null>(
    null
  );
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<{
    action: TenantSessionAction;
    message: string;
  } | null>(null);
  const busy = switchingTenantId !== null || creatingTenant || signingOut;

  async function run(input: {
    action: TenantSessionAction;
    commit: () => Promise<void>;
    destination: string;
    failureMessage: string;
  }) {
    setError(null);
    try {
      if (!controls) {
        throw new Error(LOCAL_TEARDOWN_UNAVAILABLE_MESSAGE);
      }
      return await changeIdentityAfterLocalTeardown({
        teardown:
          input.action === "sign-out"
            ? controls.teardownForLogout
            : controls.teardownForTenantChange,
        commit: input.commit,
        destination: input.destination,
        failureMessage: input.failureMessage,
        // This screen is unmounted once the teardown succeeded.
        reportFailure: controls.reportIdentityChangeFailure,
      });
    } catch (teardownError) {
      // Only the teardown throws. Nothing changed on the server, and unless
      // the wipe failed halfway (which the provider panel reports), the
      // screen that started the action is still mounted.
      console.error(`[${input.action}] local teardown failed`, teardownError);
      const message =
        teardownError instanceof Error
          ? teardownError.message
          : input.failureMessage;
      if (isUnsyncedLocalDataRefusal(teardownError)) {
        // The gate snapshot was stale; the screen explains the blocker too.
        toast.error(message);
      } else {
        setError({ action: input.action, message });
      }
      return false;
    }
  }

  async function switchTo(tenantId: string) {
    if (busy || !gate.canChange || tenantId === activeTenantId) return;
    setSwitchingTenantId(tenantId);
    const navigating = await run({
      action: "switch",
      commit: async () => {
        await switchTenant(tenantId);
        await refreshSessionForActiveTenant();
      },
      destination: "/",
      failureMessage: copy.switchFailed,
    });
    if (!navigating) setSwitchingTenantId(null);
  }

  async function create(name: string) {
    const trimmedName = name.trim();
    if (!trimmedName || busy || !gate.canChange) return;
    setCreatingTenant(true);
    const navigating = await run({
      action: "create",
      commit: async () => {
        await createTenant(trimmedName);
        await refreshSessionForActiveTenant();
      },
      destination: "/",
      failureMessage: copy.createFailed,
    });
    if (!navigating) setCreatingTenant(false);
  }

  async function signOut() {
    if (busy || !gate.canChange) return;
    setSigningOut(true);
    const navigating = await run({
      action: "sign-out",
      commit: async () => {
        try {
          await signOutOnServer();
        } catch (serverError) {
          throw new Error(SIGN_OUT_FAILED_MESSAGE, { cause: serverError });
        }
      },
      destination: "/login",
      failureMessage: SIGN_OUT_FAILED_MESSAGE,
    });
    if (!navigating) setSigningOut(false);
  }

  return {
    gate,
    busy,
    switchingTenantId,
    creatingTenant,
    signingOut,
    error,
    switchTenant: switchTo,
    createTenant: create,
    signOut,
  };
}
