// The rules for resolving a user's active tenant, shared by the server
// resolvers in lib/auth/user-context.ts and the tests. Nothing here reads or
// writes the database, Supabase or the request.

import { UserFacingError } from "@/lib/action-result";
import type { TenantSummary } from "@/lib/types";
import { requireUuid } from "@/lib/validation";

export type MembershipRow = {
  tenantId: string;
  tenantName: string;
  tenantCreatedByUserId: string | null;
  displayName: string;
};

export type UserTenantContext = {
  user: {
    id: string;
    email: string | null;
    displayName: string;
  };
  tenant: {
    id: string;
    name: string;
    createdByUserId: string | null;
  } | null;
  tenants: TenantSummary[];
};

/** The read-only resolver's result, see resolveUserTenantContextFor. */
export type ResolvedUserTenantContext = UserTenantContext & {
  /**
   * The active tenant when the session's `app_metadata.tenant_id` claim
   * already names it, which is the tenant PowerSync syncs. Null when there is
   * no tenant, or when `tenant` is the oldest-membership fallback for a
   * missing or stale claim: only the bootstrap on '/' writes that fallback
   * back to the claim.
   */
  claimedTenantId: string | null;
};

/** The fields of a Supabase Auth user the resolution reads. */
export type TenantContextUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

export const ACTIVE_TENANT_CHANGED_MESSAGE =
  "Tu puesto activo cambió en otro dispositivo. Recargá la app para continuar.";

/**
 * The tenant the screen renders is no longer one of the user's: they left it
 * on another device, or its owner removed them.
 */
export const TENANT_ACCESS_REMOVED_MESSAGE =
  "Ya no sos parte de este puesto. Recargá la app para continuar.";

const INVALID_TENANT_ID_MESSAGE = "Identificador de puesto inválido.";

export function parseTenantId(tenantId: unknown): string {
  return requireUuid(
    typeof tenantId === "string" ? tenantId.trim() : tenantId,
    INVALID_TENANT_ID_MESSAGE
  );
}

export function readClaimedTenantId(
  user: TenantContextUser
): string | undefined {
  const tenantId = user.app_metadata?.tenant_id;
  return typeof tenantId === "string" && tenantId ? tenantId : undefined;
}

export function resolveActiveMembership(
  memberships: MembershipRow[],
  claimedTenantId: string | undefined
): MembershipRow | null {
  if (memberships.length === 0) {
    return null;
  }

  if (claimedTenantId) {
    const byClaim = memberships.find(
      (membership) => membership.tenantId === claimedTenantId
    );
    if (byClaim) {
      return byClaim;
    }
  }

  return memberships[0];
}

export function getDisplayName(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}) {
  for (const key of ["display_name", "full_name", "name"] as const) {
    const metadataName = user.user_metadata?.[key];
    if (typeof metadataName === "string" && metadataName.trim()) {
      return metadataName.trim();
    }
  }

  if (user.email) {
    return user.email.split("@")[0];
  }

  return "Vendedor";
}

/** The name of the tenant the bootstrap creates on a first sign-in. */
export function personalTenantName(displayName: string) {
  return `Puesto de ${displayName}`;
}

export function toUserTenantContext(
  user: TenantContextUser,
  memberships: MembershipRow[],
  active: MembershipRow | null
): UserTenantContext {
  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      displayName: active?.displayName ?? getDisplayName(user),
    },
    tenant: active
      ? {
          id: active.tenantId,
          name: active.tenantName,
          createdByUserId: active.tenantCreatedByUserId,
        }
      : null,
    tenants: memberships.map((membership) => ({
      id: membership.tenantId,
      name: membership.tenantName,
    })),
  };
}

/**
 * Resolves the context from memberships that already exist. A user without
 * any gets `tenant: null`: creating their first tenant is the bootstrap's
 * job, never a read's.
 */
export function resolveUserTenantContextFor(
  user: TenantContextUser,
  memberships: MembershipRow[]
): ResolvedUserTenantContext {
  const claimed = readClaimedTenantId(user);
  const active = resolveActiveMembership(memberships, claimed);
  return {
    ...toUserTenantContext(user, memberships, active),
    claimedTenantId: active && active.tenantId === claimed ? claimed : null,
  };
}

/**
 * The account-wide active tenant can change on another device while this
 * one still shows the previous tenant. A tenant-scoped action therefore
 * receives the tenant its screen renders (`expectedTenantId`), and only runs
 * when that is still the active one, instead of writing into whichever
 * tenant is active now.
 */
export function requireExpectedTenant<T extends UserTenantContext>(
  context: T | null,
  expectedTenantId: unknown,
  missingTenantMessage: string
): T & { tenant: NonNullable<T["tenant"]> } {
  const expected = parseTenantId(expectedTenantId);
  const tenant = context?.tenant;
  if (!context) {
    throw new UserFacingError(missingTenantMessage);
  }
  if (!tenant || tenant.id.toLowerCase() !== expected) {
    // A screen only sends the tenant it renders, so a user without that
    // membership lost it, whether or not another puesto is left to fall
    // back to (someone who joined by invitation has no other).
    const stillMember = context.tenants.some(
      (summary) => summary.id.toLowerCase() === expected
    );
    throw new UserFacingError(
      stillMember
        ? ACTIVE_TENANT_CHANGED_MESSAGE
        : TENANT_ACCESS_REMOVED_MESSAGE
    );
  }
  return { ...context, tenant };
}
