import { asc, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { User } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { tenantUsers, tenants } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type DbOrTx = typeof db | PgTransaction<any, any, any>;

export type MembershipRow = {
  tenantId: string;
  tenantName: string;
  tenantCreatedByUserId: string | null;
  displayName: string;
  membershipCreatedAt: Date;
};

// PowerSync's sync rules read tenant_id from the JWT via
// `request.jwt() -> 'app_metadata' ->> 'tenant_id'`, so the claim has to be
// present in every authenticated token. Supabase embeds `app_metadata` as a
// top-level claim automatically; this helper makes sure the field is set
// (or backfilled for users created before we started writing it). The
// updated claim only appears on the *next* token refresh, not the current
// one, so the first sync attempt after bootstrap may still miss it.
export async function setActiveTenantClaim(user: User, tenantId: string) {
  if (user.app_metadata?.tenant_id === tenantId) {
    return;
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata ?? {}), tenant_id: tenantId },
  });
  if (error) {
    throw new Error(`Could not set tenant_id on user: ${error.message}`);
  }
}

export async function loadAllMemberships(
  client: DbOrTx,
  userId: string
): Promise<MembershipRow[]> {
  return client
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantCreatedByUserId: tenants.createdByUserId,
      displayName: tenantUsers.displayName,
      membershipCreatedAt: tenantUsers.createdAt,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, userId))
    .orderBy(asc(tenantUsers.createdAt));
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
  const metadataName = user.user_metadata?.display_name;

  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim();
  }

  if (user.email) {
    return user.email.split("@")[0];
  }

  return "Vendedor";
}

export async function ensureMembership(
  client: DbOrTx,
  input: {
    tenantId: string;
    userId: string;
    displayName: string;
  }
): Promise<{ created: boolean }> {
  // Single atomic insert: concurrent redemptions can't both pass a pre-check
  // and then collide on tenant_users_tenant_id_user_id_unique. ON CONFLICT DO
  // NOTHING returns no row when the membership already exists.
  const inserted = await client
    .insert(tenantUsers)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      displayName: input.displayName,
    })
    .onConflictDoNothing({
      target: [tenantUsers.tenantId, tenantUsers.userId],
    })
    .returning({ id: tenantUsers.id });

  return { created: inserted.length > 0 };
}

export async function assertUserIsMember(userId: string, tenantId: string) {
  const memberships = await loadAllMemberships(db, userId);
  if (!memberships.some((membership) => membership.tenantId === tenantId)) {
    throw new Error("You are not a member of this account.");
  }
}

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

function toTenantSummaries(memberships: MembershipRow[]) {
  return memberships.map((membership) => ({
    id: membership.tenantId,
    name: membership.tenantName,
  }));
}

function toUserTenantContext(
  user: User,
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
    tenants: toTenantSummaries(memberships),
  };
}

export async function ensureUserTenantContext(): Promise<UserTenantContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const claimedTenantId =
    typeof user.app_metadata?.tenant_id === "string"
      ? user.app_metadata.tenant_id
      : undefined;

  const memberships = await loadAllMemberships(db, user.id);
  const active = resolveActiveMembership(memberships, claimedTenantId);

  if (active) {
    try {
      await setActiveTenantClaim(user, active.tenantId);
    } catch (error) {
      console.error("[ensureUserTenantContext] setActiveTenantClaim failed", {
        userId: user.id,
        tenantId: active.tenantId,
        error,
      });
    }
    return toUserTenantContext(user, memberships, active);
  }

  const displayName = getDisplayName({
    email: user.email,
    user_metadata: user.user_metadata,
  });

  // Bootstrap path: create the tenant and the membership row atomically. A
  // per-user advisory lock serializes concurrent first-time sign-ins (e.g. two
  // browser tabs after sign-up) so they cannot each create their own tenant.
  // The lock is released automatically when the transaction commits or rolls
  // back. After acquiring the lock, re-check membership — another transaction
  // may have just bootstrapped this user while we were waiting.
  const context = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"user_tenant_bootstrap:" + user.id}))`
    );

    const racedMemberships = await loadAllMemberships(tx, user.id);
    const racedActive = resolveActiveMembership(
      racedMemberships,
      claimedTenantId
    );
    if (racedActive) {
      return toUserTenantContext(user, racedMemberships, racedActive);
    }

    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: `Cuenta de ${displayName}`,
        createdByUserId: user.id,
      })
      .returning({ id: tenants.id, name: tenants.name });

    if (!tenant) {
      throw new Error("Unable to create tenant for authenticated user.");
    }

    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: user.id,
      displayName,
    });

    const bootstrappedMembership: MembershipRow = {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantCreatedByUserId: user.id,
      displayName,
      membershipCreatedAt: new Date(),
    };

    return toUserTenantContext(
      user,
      [bootstrappedMembership],
      bootstrappedMembership
    );
  });

  if (context.tenant) {
    try {
      await setActiveTenantClaim(user, context.tenant.id);
    } catch (error) {
      console.error("[ensureUserTenantContext] setActiveTenantClaim failed", {
        userId: user.id,
        tenantId: context.tenant.id,
        error,
      });
    }
  }

  return context;
}
