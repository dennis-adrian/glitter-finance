// The rules for resolving a user's active tenant, shared by the server
// resolvers in lib/auth/user-context.ts and the tests. Nothing here reads or
// writes the database, Supabase or the request.

export type MembershipRow = {
  tenantId: string;
  tenantName: string;
  tenantCreatedByUserId: string | null;
  displayName: string;
  membershipCreatedAt: Date;
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
  tenants: {
    id: string;
    name: string;
  }[];
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
  "Tu puesto activo cambió en otro dispositivo. Recarga la app para continuar.";

const INVALID_TENANT_ID_MESSAGE = "Identificador de cuenta inválido.";

const TENANT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTenantId(tenantId: unknown): string {
  if (typeof tenantId !== "string") {
    throw new Error(INVALID_TENANT_ID_MESSAGE);
  }
  const normalized = tenantId.trim().toLowerCase();
  if (!TENANT_ID_RE.test(normalized)) {
    throw new Error(INVALID_TENANT_ID_MESSAGE);
  }
  return normalized;
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
  return `Cuenta de ${displayName}`;
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
  if (!context || !tenant) {
    throw new Error(missingTenantMessage);
  }
  if (tenant.id.toLowerCase() !== expected) {
    throw new Error(ACTIVE_TENANT_CHANGED_MESSAGE);
  }
  return { ...context, tenant };
}
