import { cache } from "react";
import { sql } from "drizzle-orm";
import type { User } from "@supabase/supabase-js";
import {
  createTenantWithOwner,
  hasMembership,
  loadAllMemberships,
} from "@/lib/auth/memberships";
import {
  getDisplayName,
  personalTenantName,
  readClaimedTenantId,
  resolveActiveMembership,
  resolveUserTenantContextFor,
  toUserTenantContext,
  type ResolvedUserTenantContext,
  type UserTenantContext,
} from "@/lib/auth/tenant-context";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user, verified with the Auth server once per request.
 * getUser() (not getSession or getClaims) because tenant resolution needs
 * the current app_metadata, which a not yet refreshed JWT does not carry,
 * and because tenant writes must not run for a revoked session.
 *
 * Memoized for the request, so it must not be called before an action
 * changes the session in that same request (sign-in, sign-up).
 */
export const getAuthenticatedUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// PowerSync's sync rules read tenant_id from the JWT via
// `auth.parameters() -> 'app_metadata' ->> 'tenant_id'`, so the claim has to
// be present in every authenticated token. Supabase embeds `app_metadata` as
// a top-level claim automatically; this helper makes sure the field is set
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
    throw new Error("No se pudo actualizar la cuenta activa.");
  }
}

export async function assertUserIsMember(userId: string, tenantId: string) {
  if (!(await hasMembership(db, { tenantId, userId }))) {
    throw new Error("No perteneces a esta cuenta.");
  }
}

/**
 * Read-only: resolves the active tenant from the user's existing
 * memberships, without creating a tenant or writing the claim. Pages other
 * than '/' (the join page) and server actions use it; a user who has no
 * membership yet gets `tenant: null`.
 */
export const resolveUserTenantContext = cache(
  async (): Promise<ResolvedUserTenantContext | null> => {
    const user = await getAuthenticatedUser();
    if (!user) {
      return null;
    }
    return resolveUserTenantContextFor(
      user,
      await loadAllMemberships(db, user.id)
    );
  }
);

/**
 * Resolves the active tenant and writes it back to the claim, creating the
 * user's first tenant when they have no membership. Only '/' and the
 * sign-in/sign-up actions (outside the invite path) run it, so a user who
 * signs up through an invitation only ever joins the inviter's tenant.
 */
export async function ensureUserTenantContext(): Promise<UserTenantContext | null> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return null;
  }

  const claimedTenantId = readClaimedTenantId(user);
  const memberships = await loadAllMemberships(db, user.id);
  const active = resolveActiveMembership(memberships, claimedTenantId);

  // Bootstrap path: create the tenant and the membership row atomically. A
  // per-user advisory lock serializes concurrent first-time sign-ins (e.g. two
  // browser tabs after sign-up) so they cannot each create their own tenant.
  // The lock is released automatically when the transaction commits or rolls
  // back. After acquiring the lock, re-check membership — another transaction
  // may have just bootstrapped this user while we were waiting.
  const context = active
    ? toUserTenantContext(user, memberships, active)
    : await db.transaction(async (tx) => {
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

        const displayName = getDisplayName(user);
        const membership = await createTenantWithOwner(tx, {
          name: personalTenantName(displayName),
          userId: user.id,
          displayName,
        });
        return toUserTenantContext(user, [membership], membership);
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
