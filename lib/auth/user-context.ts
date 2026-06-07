import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantUsers, tenants } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export type UserTenantContext = {
  user: {
    id: string;
    email: string | null;
  };
  tenant: {
    id: string;
    name: string;
  } | null;
};

function getDisplayName(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadataName = user.user_metadata?.display_name;

  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim();
  }

  if (user.email) {
    return user.email.split("@")[0];
  }

  return "Vendedor";
}

export async function ensureUserTenantContext(): Promise<UserTenantContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [membership] = await db
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      displayName: tenantUsers.displayName,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, user.id))
    .limit(1);

  if (membership) {
    return {
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      tenant: {
        id: membership.tenantId,
        name: membership.tenantName,
      },
    };
  }

  const displayName = getDisplayName({
    email: user.email,
    user_metadata: user.user_metadata,
  });

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: `Cuenta de ${displayName}`,
    })
    .returning({
      id: tenants.id,
      name: tenants.name,
    });

  if (!tenant) {
    throw new Error("Unable to create tenant for authenticated user.");
  }

  await db.insert(tenantUsers).values({
    tenantId: tenant.id,
    userId: user.id,
    displayName,
  });

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    tenant,
  };
}
