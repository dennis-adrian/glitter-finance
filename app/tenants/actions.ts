"use server";

import { toActionResult, UserFacingError } from "@/lib/action-result";
import { removeMembership } from "@/lib/auth/membership-removal";
import { createTenantWithOwner, hasMembership } from "@/lib/auth/memberships";
import { getDisplayName, parseTenantId } from "@/lib/auth/tenant-context";
import {
  assertUserIsMember,
  getAuthenticatedUser,
  moveActiveTenantClaimAway,
  requireExpectedTenantContext,
  setActiveTenantClaim,
} from "@/lib/auth/user-context";
import { db } from "@/lib/db";
import { requireUuid } from "@/lib/validation";

const NOT_SIGNED_IN_MESSAGE = "No iniciaste sesión.";
const NO_TENANT_MESSAGE = "No tenés un puesto activo.";

function parseTenantName(name: unknown): string {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    throw new UserFacingError("El nombre del puesto es obligatorio.");
  }
  return trimmedName;
}

// Expected failures come back as `{ ok: false, error }` (lib/action-result.ts).

export async function switchTenant(tenantId: string) {
  return toActionResult(async () => {
    const normalizedTenantId = parseTenantId(tenantId);
    const user = await getAuthenticatedUser();

    if (!user) {
      throw new UserFacingError(NOT_SIGNED_IN_MESSAGE);
    }

    await assertUserIsMember(user.id, normalizedTenantId);
    await setActiveTenantClaim(user, normalizedTenantId);
  });
}

/**
 * Switches back to the tenant this device still holds unsynced work for (the
 * local data recovery panel). A membership removed meanwhile is an answer,
 * not an error: the panel then offers its other ways out, since that
 * tenant's work can no longer be uploaded or resolved there.
 */
export async function returnToTenant(tenantId: string) {
  return toActionResult(async (): Promise<"switched" | "no-access"> => {
    const normalizedTenantId = parseTenantId(tenantId);
    const user = await getAuthenticatedUser();

    if (!user) {
      throw new UserFacingError(NOT_SIGNED_IN_MESSAGE);
    }

    if (
      !(await hasMembership(db, {
        tenantId: normalizedTenantId,
        userId: user.id,
      }))
    ) {
      return "no-access";
    }
    await setActiveTenantClaim(user, normalizedTenantId);
    return "switched";
  });
}

export async function createTenant(name: string) {
  return toActionResult(async () => {
    const trimmedName = parseTenantName(name);
    const user = await getAuthenticatedUser();

    if (!user) {
      throw new UserFacingError(NOT_SIGNED_IN_MESSAGE);
    }

    const membership = await db.transaction((tx) =>
      createTenantWithOwner(tx, {
        name: trimmedName,
        userId: user.id,
        displayName: getDisplayName(user),
      })
    );
    const tenant = { id: membership.tenantId, name: membership.tenantName };

    // The tenant + membership are already committed. A failure setting the
    // active claim must NOT propagate as a failed create — otherwise a retry
    // would create a duplicate tenant. The next ensureUserTenantContext on
    // '/' reconciles the claim, and the client can still switch into the new
    // tenant from the list.
    try {
      await setActiveTenantClaim(user, tenant.id);
    } catch (error) {
      console.error("[createTenant] setActiveTenantClaim failed", error);
    }
    return tenant;
  });
}

/**
 * The membership is already gone when this runs, so failing to move the
 * claim is not a failed removal: the device notices the lost membership
 * either way (lib/powersync/tenant-access.ts), and '/' resolves another
 * tenant whatever the claim says.
 */
async function moveClaimAwayAfterRemoval(userId: string, tenantId: string) {
  try {
    await moveActiveTenantClaimAway(userId, tenantId);
  } catch (error) {
    console.error("[tenants] moving the active tenant claim failed", {
      userId,
      tenantId,
      error,
    });
  }
}

/**
 * The owner removes another member. Their sales and stock counts stay, under
 * the name they had; their devices stop syncing the tenant at once (the sync
 * streams require a membership) and ask them to reload. The tenant's active
 * invitation link is revoked too, so the link they joined with cannot bring
 * them back.
 */
export async function removeTenantMember(
  expectedTenantId: string,
  memberUserId: string
) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      NO_TENANT_MESSAGE
    );
    const memberId = requireUuid(memberUserId, "Miembro inválido.");
    if (memberId === context.user.id) {
      throw new UserFacingError(
        "Para irte del puesto, usá «Salir del puesto»."
      );
    }

    await removeMembership({
      actorUserId: context.user.id,
      tenantId: context.tenant.id,
      memberUserId: memberId,
    });
    await moveClaimAwayAfterRemoval(memberId, context.tenant.id);
  });
}

/**
 * The signed-in member leaves the tenant this screen renders. The client tears
 * down its local data before (the same gate as a switch), then refreshes the
 * session and reloads into the tenant the claim now names.
 */
export async function leaveTenant(expectedTenantId: string) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      NO_TENANT_MESSAGE
    );

    await removeMembership({
      actorUserId: context.user.id,
      tenantId: context.tenant.id,
      memberUserId: context.user.id,
    });
    await moveClaimAwayAfterRemoval(context.user.id, context.tenant.id);
  });
}
