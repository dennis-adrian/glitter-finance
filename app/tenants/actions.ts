"use server";

import { createTenantWithOwner } from "@/lib/auth/memberships";
import { getDisplayName, parseTenantId } from "@/lib/auth/tenant-context";
import {
  assertUserIsMember,
  getAuthenticatedUser,
  setActiveTenantClaim,
} from "@/lib/auth/user-context";
import { db } from "@/lib/db";

function parseTenantName(name: unknown): string {
  if (typeof name !== "string") {
    throw new Error("El nombre de la cuenta es obligatorio.");
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("El nombre de la cuenta es obligatorio.");
  }
  return trimmedName;
}

export async function switchTenant(tenantId: string) {
  const normalizedTenantId = parseTenantId(tenantId);
  const user = await getAuthenticatedUser();

  if (!user) {
    throw new Error("No has iniciado sesión.");
  }

  await assertUserIsMember(user.id, normalizedTenantId);
  await setActiveTenantClaim(user, normalizedTenantId);
}

export async function createTenant(name: string) {
  const trimmedName = parseTenantName(name);
  const user = await getAuthenticatedUser();

  if (!user) {
    throw new Error("No has iniciado sesión.");
  }

  const membership = await db.transaction((tx) =>
    createTenantWithOwner(tx, {
      name: trimmedName,
      userId: user.id,
      displayName: getDisplayName(user),
    })
  );
  const tenant = { id: membership.tenantId, name: membership.tenantName };

  // The tenant + membership are already committed. A failure setting the active
  // claim must NOT propagate as a failed create — otherwise a retry would
  // create a duplicate tenant. The next ensureUserTenantContext on '/'
  // reconciles the claim, and the client can still switch into the new tenant
  // from the list.
  try {
    await setActiveTenantClaim(user, tenant.id);
  } catch (error) {
    console.error("[createTenant] setActiveTenantClaim failed", error);
  }
  return tenant;
}
