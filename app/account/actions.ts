"use server";

import { toActionResult, UserFacingError } from "@/lib/action-result";
import {
  deleteAccountData,
  finishAccountAuthDeletion,
  finishPendingAuthDeletions,
  loadAccountDeletionPlan,
  storageCleanupQueue,
} from "@/lib/auth/membership-removal";
import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  isAccountDeletionConfirmed,
} from "@/lib/auth/tenant-owner";
import { getAuthenticatedUser } from "@/lib/auth/user-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { drainTenantStorageCleanups } from "@/lib/tenant-storage-cleanup";

const NOT_SIGNED_IN_MESSAGE = "No iniciaste sesión.";

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
 * 1. In one short transaction under the account's lock, Postgres ends every
 *    membership (a puesto the user shares is left, with their sales, refunds
 *    and stock counts kept under their name; a puesto where they are the
 *    only member is deleted with all its data and queued for photo cleanup)
 *    and records the account in deleted_accounts. Refused while they own a
 *    puesto that has other members. From the commit on, the account gets
 *    no new membership or puesto: a join racing this either went in first
 *    and is deleted with the rest, or is refused.
 * 2. Every session of the user is revoked, on every device.
 * 3. The auth user is soft-deleted: Supabase clears its email, password,
 *    identities and metadata, so nobody can sign in to it again and the
 *    email can sign up anew, while the row the kept sales point at stays.
 * 4. Older deletions whose Auth side did not finish are retried.
 * 5. The deleted puestos' photos are removed from Storage (queued, retried
 *    by the next account deletion if this fails).
 *
 * No transaction stays open across the Auth calls. If 2 or 3 fail, the
 * account is already deleted for the app: its next visit finishes 3
 * (ensureUserTenantContext), and so does the next account deletion (4).
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

    const supabase = await createClient();
    const admin = createAdminClient();
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "global",
    });
    if (signOutError) {
      // The soft delete below ends what it can; the app refuses the account
      // either way (deleted_accounts).
      console.error("[account] revoking the sessions failed", {
        userId: user.id,
        code: signOutError.code ?? null,
        status: signOutError.status ?? null,
      });
    }

    await finishAccountAuthDeletion(admin, user.id).catch((error) => {
      console.error("[account] deleting the auth user failed", {
        userId: user.id,
        error,
      });
    });

    // Best effort, like the photos: nothing above may wait for them.
    await finishPendingAuthDeletions(admin).catch((error) => {
      console.error("[account] retrying older Auth deletions failed", {
        error,
      });
    });

    try {
      const { failed } = await drainTenantStorageCleanups(
        admin,
        storageCleanupQueue,
        deletedTenantIds
      );
      if (failed.length > 0) {
        console.error("[account] some photo cleanups stay queued", {
          userId: user.id,
          tenantIds: failed,
        });
      }
    } catch (error) {
      // The cleanup rows are committed with the deletion, so the next run
      // picks them up; the account is already deleted.
      console.error("[account] reading the photo cleanup queue failed", {
        userId: user.id,
        error,
      });
    }
  });
}
