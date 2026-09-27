"use server";

import { toActionResult, UserFacingError } from "@/lib/action-result";
import { createTenantWithOwner } from "@/lib/auth/memberships";
import { getDisplayName, parseTenantId } from "@/lib/auth/tenant-context";
import {
  assertUserIsMember,
  getAuthenticatedUser,
  setActiveTenantClaim,
} from "@/lib/auth/user-context";
import { db } from "@/lib/db";

const NOT_SIGNED_IN_MESSAGE = "No has iniciado sesión.";

function parseTenantName(name: unknown): string {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    throw new UserFacingError("El nombre de la cuenta es obligatorio.");
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
