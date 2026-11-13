import "server-only";

import { sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { TENANT_ACCESS_REMOVED_MESSAGE } from "@/lib/auth/tenant-context";
import {
  planAccountDeletion,
  type AccountDeletionPlan,
} from "@/lib/auth/tenant-owner";
import { db } from "@/lib/db";
import { postgresErrorCode } from "@/lib/db/errors";
import type { StorageCleanupQueue } from "@/lib/tenant-storage-cleanup";

// The trusted side of removing members, leaving and deleting an account. The
// rules themselves live in Postgres (remove_tenant_member and
// delete_account_data in
// supabase/manual/20261113120000_tenant_membership_removal.sql), which raise
// these SQLSTATEs when a request breaks one.

export const MEMBERSHIP_REMOVAL_MESSAGES = {
  BF401: TENANT_ACCESS_REMOVED_MESSAGE,
  BF403: "Solo quien creó el puesto puede quitar a otros miembros.",
  BF404: "Esa persona ya no es parte del puesto.",
  BF409:
    "Creaste este puesto, así que no podés salir de él mientras tenga otros miembros.",
} as const;

export const ACCOUNT_DELETION_BLOCKED_MESSAGE =
  "Creaste un puesto que tiene otros miembros. Quitalos del equipo antes de eliminar tu cuenta.";

function membershipErrorMessage(
  error: unknown,
  messages: Readonly<Record<string, string>>
): string | null {
  const code = postgresErrorCode(error);
  return code && Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code]
    : null;
}

/**
 * Removes `memberUserId` from the tenant on behalf of `actorUserId`, or makes
 * the actor leave when both are the same user. Removing someone else also
 * revokes the tenant's active invitation links.
 */
export async function removeMembership(input: {
  actorUserId: string;
  tenantId: string;
  memberUserId: string;
}): Promise<void> {
  try {
    await db.execute(
      sql`SELECT public.remove_tenant_member(${input.actorUserId}::uuid, ${input.tenantId}::uuid, ${input.memberUserId}::uuid)`
    );
  } catch (error) {
    const message = membershipErrorMessage(error, MEMBERSHIP_REMOVAL_MESSAGES);
    if (message) {
      throw new UserFacingError(message, { cause: error });
    }
    throw error;
  }
}

/** What deleting the user's account would do to each of their puestos. */
export async function loadAccountDeletionPlan(
  userId: string
): Promise<AccountDeletionPlan> {
  const rows = await db.execute<{
    id: string;
    name: string;
    other_member_count: number;
    is_owner: boolean;
  }>(sql`
    SELECT
      t.id,
      t.name,
      (
        SELECT count(*)::int
        FROM public.tenant_users other
        WHERE other.tenant_id = t.id
          AND other.user_id <> ${userId}::uuid
      ) AS other_member_count,
      coalesce(public.tenant_owner_user_id(t.id) = ${userId}::uuid, false) AS is_owner
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = ${userId}::uuid
    ORDER BY tu.created_at, tu.id
  `);
  return planAccountDeletion(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      otherMemberCount: Number(row.other_member_count),
      isOwner: row.is_owner,
    }))
  );
}

/**
 * Ends every membership of the user, deleting the puestos where they are the
 * only member with all their data. Resolves to the deleted puestos' ids.
 * Safe to run again: a user without memberships deletes nothing.
 */
export async function deleteAccountData(userId: string): Promise<string[]> {
  try {
    const rows = await db.execute<{ tenant_id: string }>(
      sql`SELECT unnest(public.delete_account_data(${userId}::uuid))::text AS tenant_id`
    );
    return rows.map((row) => row.tenant_id);
  } catch (error) {
    if (postgresErrorCode(error) === "BF409") {
      throw new UserFacingError(ACCOUNT_DELETION_BLOCKED_MESSAGE, {
        cause: error,
      });
    }
    throw error;
  }
}

/** tenant_storage_cleanups, on the trusted connection. */
export const storageCleanupQueue: StorageCleanupQueue = {
  async pending(first, limit) {
    const rows = await db.execute<{ tenant_id: string }>(sql`
      SELECT tenant_id::text AS tenant_id
      FROM public.tenant_storage_cleanups
      ORDER BY
        tenant_id::text IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(first)}::jsonb)
        ) DESC,
        requested_at,
        tenant_id
      LIMIT ${limit}
    `);
    return rows.map((row) => row.tenant_id);
  },
  async complete(tenantId) {
    await db.execute(
      sql`DELETE FROM public.tenant_storage_cleanups WHERE tenant_id = ${tenantId}::uuid`
    );
  },
  async fail(tenantId, message) {
    await db.execute(
      sql`UPDATE public.tenant_storage_cleanups SET last_error = left(${message}, 500) WHERE tenant_id = ${tenantId}::uuid`
    );
  },
};
