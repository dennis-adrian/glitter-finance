// Who may remove whom from a puesto, and what deleting an account does to
// each puesto. Postgres enforces the same rules (remove_tenant_member,
// delete_account_data and the tenant_users triggers in
// supabase/manual/20261113120000_tenant_membership_removal.sql); this module
// lets the screens offer only what the server will accept and say why.
// Nothing here reads the database or the request.

import type { TenantSummary } from "@/lib/types";

/**
 * The puesto's owner: its creator while they are a member, otherwise (a
 * puesto from before the creator was recorded) the longest-standing member.
 * `members` must be in joining order, as every member list is.
 */
export function resolveTenantOwnerId(
  createdByUserId: string | null,
  members: readonly { userId: string }[]
): string | null {
  if (
    createdByUserId &&
    members.some((member) => member.userId === createdByUserId)
  ) {
    return createdByUserId;
  }
  return members[0]?.userId ?? null;
}

/**
 * What the signed-in member may do to `memberUserId` from the team list:
 * leave (it is themselves), remove (they own the puesto), or nothing. The
 * owner never leaves: a puesto always keeps its owner.
 */
export function memberActionFor(input: {
  actorUserId: string;
  ownerUserId: string | null;
  memberUserId: string;
}): "leave" | "remove" | null {
  const { actorUserId, ownerUserId, memberUserId } = input;
  if (memberUserId === actorUserId) {
    return actorUserId === ownerUserId ? null : "leave";
  }
  return actorUserId === ownerUserId ? "remove" : null;
}

/** One of the user's puestos, as the account deletion plan reads it. */
export type AccountDeletionMembership = TenantSummary & {
  /** How many other members it has. */
  otherMemberCount: number;
  isOwner: boolean;
};

export type AccountDeletionPlan = {
  /** Puestos where the user is the only member: deleted with their data. */
  deletes: TenantSummary[];
  /** Shared puestos the user leaves; their records stay there. */
  leaves: TenantSummary[];
  /**
   * Puestos the user owns that have other members. The account cannot be
   * deleted until those members are removed.
   */
  blockers: TenantSummary[];
};

export function planAccountDeletion(
  memberships: readonly AccountDeletionMembership[]
): AccountDeletionPlan {
  const plan: AccountDeletionPlan = { deletes: [], leaves: [], blockers: [] };
  for (const { id, name, otherMemberCount, isOwner } of memberships) {
    const tenant = { id, name };
    if (otherMemberCount === 0) {
      plan.deletes.push(tenant);
    } else if (isOwner) {
      plan.blockers.push(tenant);
    } else {
      plan.leaves.push(tenant);
    }
  }
  return plan;
}

/** The word the user types to confirm deleting their account. */
export const ACCOUNT_DELETION_CONFIRMATION_WORD = "ELIMINAR";

export function isAccountDeletionConfirmed(input: unknown): boolean {
  return (
    typeof input === "string" &&
    input.trim().toUpperCase() === ACCOUNT_DELETION_CONFIRMATION_WORD
  );
}
