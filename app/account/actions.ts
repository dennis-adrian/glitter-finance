"use server";

import { toActionResult, UserFacingError } from "@/lib/action-result";
import {
  deleteAccountData,
  loadAccountDeletionPlan,
} from "@/lib/auth/membership-removal";
import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  isAccountDeletionConfirmed,
} from "@/lib/auth/tenant-owner";
import { getAuthenticatedUser } from "@/lib/auth/user-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { removeTenantStorageObjects } from "@/lib/tenant-storage-cleanup";

const NOT_SIGNED_IN_MESSAGE = "No iniciaste sesión.";
const DELETION_INCOMPLETE_MESSAGE =
  "Tus puestos ya se eliminaron, pero la cuenta no terminó de borrarse. Iniciá sesión y volvé a intentarlo.";

async function requireUser() {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new UserFacingError(NOT_SIGNED_IN_MESSAGE);
  }
  return user;
}

/** What deleting the account would do, for the confirmation step. */
export async function getAccountDeletionPlan() {
  return toActionResult(async () => {
    const user = await requireUser();
    return loadAccountDeletionPlan(user.id);
  });
}

/**
 * Deletes the signed-in user's account. The client has already torn down
 * this device's local data, which it refuses to do while anything is
 * unsynced, exactly as for a sign-out.
 *
 * 1. Postgres ends every membership: a puesto the user shares is left, with
 *    their sales, refunds and stock counts kept under their name; a puesto
 *    where they are the only member is deleted with all its data. Refused
 *    while they own a puesto that has other members.
 * 2. The deleted puestos' product photos are removed from Storage.
 * 3. Every session of the user is revoked, on every device.
 * 4. The auth user is soft-deleted: Supabase clears its email, password,
 *    identities and metadata, so nobody can sign in to it again and the
 *    email can sign up anew, while the row the kept sales point at stays.
 *
 * Each step is safe to repeat, so a failed deletion is retried by running
 * this again.
 */
export async function deleteAccount(confirmation: string) {
  return toActionResult(async () => {
    if (!isAccountDeletionConfirmed(confirmation)) {
      throw new UserFacingError(
        `Escribí ${ACCOUNT_DELETION_CONFIRMATION_WORD} para confirmar.`
      );
    }
    const user = await requireUser();

    const deletedTenantIds = await deleteAccountData(user.id);

    const admin = createAdminClient();
    try {
      await removeTenantStorageObjects(admin, deletedTenantIds);
    } catch (error) {
      // The puestos are gone; their photos are only orphaned files now.
      console.error("[account] removing deleted puestos' photos failed", {
        userId: user.id,
        tenantIds: deletedTenantIds,
        error,
      });
    }

    const supabase = await createClient();
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "global",
    });
    if (signOutError) {
      console.error("[account] revoking the sessions failed", {
        userId: user.id,
        code: signOutError.code ?? null,
        status: signOutError.status ?? null,
      });
      throw new UserFacingError(DELETION_INCOMPLETE_MESSAGE);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(
      user.id,
      true
    );
    if (deleteError) {
      console.error("[account] deleting the auth user failed", {
        userId: user.id,
        code: deleteError.code ?? null,
        status: deleteError.status ?? null,
      });
      throw new UserFacingError(DELETION_INCOMPLETE_MESSAGE);
    }
  });
}
