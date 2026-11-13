import "server-only";

import { cache } from "react";
import { sql } from "drizzle-orm";
import type { User } from "@supabase/supabase-js";
import { UserFacingError } from "@/lib/action-result";
import {
  createTenantWithOwner,
  hasMembership,
  loadAllMemberships,
} from "@/lib/auth/memberships";
import {
  getDisplayName,
  personalTenantName,
  readClaimedTenantId,
  requireExpectedTenant,
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
  // A deleted account (app/account/actions.ts) has its sessions revoked,
  // so the Auth server already refuses its tokens; never act for one anyway.
  return user && !user.deleted_at ? user : null;
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
    throw new Error("No se pudo actualizar el puesto activo.");
  }
}

/**
 * After a membership ended: when the user's claim still names that tenant,
 * points it at their oldest remaining membership, or clears it when none is
 * left. Their devices then see a refreshed token that no longer claims the
 * tenant (lib/powersync/connector.ts), and '/' resolves the same tenant.
 */
export async function moveActiveTenantClaimAway(
  userId: string,
  tenantId: string
) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new Error("No se pudo leer el puesto activo.", { cause: error });
  }
  const appMetadata = data.user.app_metadata ?? {};
  if (appMetadata.tenant_id !== tenantId) {
    return;
  }
  const [next] = await loadAllMemberships(db, userId);
  // Auth merges app_metadata on update, and a null value removes the key:
  // send only the claim, so no other key is written back from the read above.
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { tenant_id: next?.tenantId ?? null },
  });
  if (updateError) {
    throw new Error("No se pudo actualizar el puesto activo.", {
      cause: updateError,
    });
  }
}

export async function assertUserIsMember(userId: string, tenantId: string) {
  if (!(await hasMembership(db, { tenantId, userId }))) {
    throw new UserFacingError("No pertenecés a este puesto.");
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
 * For tenant-scoped server actions: the context, once the tenant the calling
 * screen renders is confirmed to still be the active one.
 */
export async function requireExpectedTenantContext(
  expectedTenantId: unknown,
  missingTenantMessage: string
) {
  return requireExpectedTenant(
    await resolveUserTenantContext(),
    expectedTenantId,
    missingTenantMessage
  );
}

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
