"use server";

import {
  assertUserIsMember,
  getDisplayName,
  setActiveTenantClaim,
} from "@/lib/auth/user-context";
import { db } from "@/lib/db";
import { tenantUsers, tenants } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

const TENANT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTenantId(tenantId: unknown): string {
  if (typeof tenantId !== "string") {
    throw new Error("Identificador de cuenta inválido.");
  }
  const normalized = tenantId.trim();
  if (!TENANT_ID_RE.test(normalized)) {
    throw new Error("Identificador de cuenta inválido.");
  }
  return normalized;
}

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("No has iniciado sesión.");
  }

  await assertUserIsMember(user.id, normalizedTenantId);
  await setActiveTenantClaim(user, normalizedTenantId);
}

export async function createTenant(name: string) {
  const trimmedName = parseTenantName(name);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("No has iniciado sesión.");
  }

  const displayName = getDisplayName({
    email: user.email,
    user_metadata: user.user_metadata,
  });

  const tenant = await db.transaction(async (tx) => {
    const [createdTenant] = await tx
      .insert(tenants)
      .values({
        name: trimmedName,
        createdByUserId: user.id,
      })
      .returning({ id: tenants.id, name: tenants.name });

    if (!createdTenant) {
      throw new Error("No se pudo crear la cuenta.");
    }

    await tx.insert(tenantUsers).values({
      tenantId: createdTenant.id,
      userId: user.id,
      displayName,
    });

    return createdTenant;
  });

  // The tenant + membership are already committed. A failure setting the active
  // claim must NOT propagate as a failed create — otherwise a retry would
  // create a duplicate tenant. The next ensureUserTenantContext reconciles the
  // claim, and the client can still switch into the new tenant from the list.
  try {
    await setActiveTenantClaim(user, tenant.id);
  } catch (error) {
    console.error("[createTenant] setActiveTenantClaim failed", error);
  }
  return tenant;
}
