"use client";

import { useState } from "react";
import { toast } from "sonner";
import { deleteAccount as deleteAccountOnServer } from "@/app/account/actions";
import { signOut as signOutOnServer } from "@/app/auth/actions";
import {
  createTenant,
  leaveTenant as leaveTenantOnServer,
  switchTenant,
} from "@/app/tenants/actions";
import { usePowerSyncControls } from "@/components/providers/powersync-provider";
import { unwrapActionResult } from "@/lib/action-result";
import {
  changeIdentityAfterLocalTeardown,
  LOCAL_TEARDOWN_UNAVAILABLE_MESSAGE,
  refreshSessionForActiveTenant,
  SIGN_OUT_FAILED_MESSAGE,
} from "@/lib/auth/identity-change";
import { isUnsyncedLocalDataRefusal } from "@/lib/powersync/local-data-teardown";
import { useLocalDataChangeGate } from "@/lib/powersync/use-local-data-change-gate";

/** Screen wording, so each screen keeps its own term for a tenant. */
export type TenantSessionCopy = {
  switchFailed: string;
  createFailed: string;
};

export type TenantSessionAction =
  | "switch"
  | "create"
  | "sign-out"
  | "leave"
  | "delete-account";

export const LEAVE_TENANT_FAILED_MESSAGE = "No se pudo salir del puesto.";
export const DELETE_ACCOUNT_FAILED_MESSAGE = "No se pudo eliminar la cuenta.";

/** Where the browser lands once the account is deleted. */
export const ACCOUNT_DELETED_DESTINATION = "/login?message=account_deleted";

/**
 * Switching, creating or leaving a tenant, signing out and deleting the
 * account, shared by More and Settings. All of them clear the local data, so
 * they share one gate and one order: refuse while unsynced, tear down, run
 * the server action, reload.
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
  const [leavingTenant, setLeavingTenant] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [error, setError] = useState<{
    action: TenantSessionAction;
    message: string;
  } | null>(null);
  const busy =
    switchingTenantId !== null ||
    creatingTenant ||
    signingOut ||
    leavingTenant ||
    deletingAccount;

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
          input.action === "sign-out" || input.action === "delete-account"
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
        await unwrapActionResult(
          () => switchTenant(tenantId),
          copy.switchFailed
        );
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
        await unwrapActionResult(
          () => createTenant(trimmedName),
          copy.createFailed
        );
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

  /** Leaves the active tenant, then reloads into the one the claim names. */
  async function leaveTenant() {
    if (busy || !gate.canChange || !activeTenantId) return;
    setLeavingTenant(true);
    const tenantId = activeTenantId;
    const navigating = await run({
      action: "leave",
      commit: async () => {
        await unwrapActionResult(
          () => leaveTenantOnServer(tenantId),
          LEAVE_TENANT_FAILED_MESSAGE
        );
        await refreshSessionForActiveTenant();
      },
      destination: "/",
      failureMessage: LEAVE_TENANT_FAILED_MESSAGE,
    });
    if (!navigating) setLeavingTenant(false);
  }

  /**
   * Deletes the account once the user typed the confirmation word. The
   * server revokes every session, so the browser goes to the login page.
   */
  async function deleteAccount(confirmation: string) {
    if (busy || !gate.canChange) return;
    setDeletingAccount(true);
    const navigating = await run({
      action: "delete-account",
      commit: () =>
        unwrapActionResult(
          () => deleteAccountOnServer(confirmation),
          DELETE_ACCOUNT_FAILED_MESSAGE
        ),
      destination: ACCOUNT_DELETED_DESTINATION,
      failureMessage: DELETE_ACCOUNT_FAILED_MESSAGE,
    });
    if (!navigating) setDeletingAccount(false);
  }

  return {
    gate,
    busy,
    switchingTenantId,
    creatingTenant,
    signingOut,
    leavingTenant,
    deletingAccount,
    error,
    switchTenant: switchTo,
    createTenant: create,
    signOut,
    leaveTenant,
    deleteAccount,
  };
}
