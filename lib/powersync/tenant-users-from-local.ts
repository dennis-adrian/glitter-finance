import type { TenantMember } from "@/lib/types";

export type LocalTenantUserRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  display_name: string;
  created_at: string;
};

export function mapTenantUserRow(row: LocalTenantUserRow): TenantMember {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export function buildUserNameMap(
  members: TenantMember[]
): Map<string, string> {
  return new Map(members.map((member) => [member.userId, member.displayName]));
}

export function tenantMembersEqual(
  left: TenantMember[],
  right: TenantMember[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.id !== b.id ||
      a.userId !== b.userId ||
      a.displayName !== b.displayName
    ) {
      return false;
    }
  }
  return true;
}

/** True when every member in `subset` also appears in `superset` (by userId). */
export function isTenantMembersSubset(
  subset: TenantMember[],
  superset: TenantMember[]
): boolean {
  if (subset.length === 0) {
    return false;
  }
  const supersetUserIds = new Set(superset.map((member) => member.userId));
  return subset.every((member) => supersetUserIds.has(member.userId));
}

/**
 * True when local SQLite replication can be trusted for team UI and seller names.
 * Empty local reads after sync are not trusted while the server hydrated a team.
 */
export function isTeamReplicationConfirmed(
  local: TenantMember[],
  serverHydrated: TenantMember[],
  hasSynced: boolean
): boolean {
  if (local.length > 0) {
    if (serverHydrated.length === 0) {
      return true;
    }
    const localUserIds = new Set(local.map((member) => member.userId));
    if (serverHydrated.every((member) => localUserIds.has(member.userId))) {
      return true;
    }
    // After full sync, a strict subset reflects server-side removals — not
    // partial replication still catching up to the hydrated member list.
    return hasSynced && isTenantMembersSubset(local, serverHydrated);
  }
  return hasSynced && serverHydrated.length === 0;
}

export type MergeTenantMembersOptions = {
  /**
   * When true, accept a strictly smaller mapped set (member removed server-side).
   * Sticky once replication has been confirmed (full match or post-sync shrink).
   */
  allowMemberShrink?: boolean;
  /**
   * When true this tick, accept shrink via {@link isTeamReplicationConfirmed}
   * even if allowMemberShrink was never set on a prior watch result.
   */
  replicationConfirmed?: boolean;
};

/** Apply a tenant_users watch result without shrinking a fuller hydrated list. */
export function mergeTenantMembersFromWatch(
  previous: TenantMember[],
  mapped: TenantMember[],
  options: MergeTenantMembersOptions = {}
): TenantMember[] {
  const { allowMemberShrink = false, replicationConfirmed = false } = options;
  const mayAcceptShrink = allowMemberShrink || replicationConfirmed;

  if (mapped.length === 0 && previous.length > 0 && !mayAcceptShrink) {
    return previous;
  }
  // Partial replication delivers a strict subset of members before the full
  // set arrives. Compare counts, not just userIds — same-sized sets with
  // updated display names (or ids) must flow through. Once replication has
  // been confirmed at least once (including post-sync shrink), accept removals.
  if (
    mapped.length > 0 &&
    previous.length > 0 &&
    mapped.length < previous.length &&
    isTenantMembersSubset(mapped, previous) &&
    !mayAcceptShrink
  ) {
    return previous;
  }
  if (tenantMembersEqual(previous, mapped)) {
    return previous;
  }
  return mapped;
}

export function resolveUserDisplayName(
  userId: string,
  members: TenantMember[],
  fallback = "Vendedor"
): string {
  return buildUserNameMap(members).get(userId) ?? fallback;
}
