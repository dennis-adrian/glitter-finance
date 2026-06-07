import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { User } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { tenantUsers, tenants } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type DbOrTx = typeof db | PgTransaction<any, any, any>;

// PowerSync's sync rules read tenant_id from the JWT via
// `request.jwt() -> 'app_metadata' ->> 'tenant_id'`, so the claim has to be
// present in every authenticated token. Supabase embeds `app_metadata` as a
// top-level claim automatically; this helper makes sure the field is set
// (or backfilled for users created before we started writing it). The
// updated claim only appears on the *next* token refresh, not the current
// one, so the first sync attempt after bootstrap may still miss it.
async function ensureAppMetadataTenantId(user: User, tenantId: string) {
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

async function loadMembership(client: DbOrTx, userId: string) {
  const [row] = await client
    .select({
      tenantId: tenants.id,
      tenantName: tenants.name,
      displayName: tenantUsers.displayName,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(eq(tenantUsers.userId, userId))
    .limit(1);
  return row;
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
  } | null;
};

function getDisplayName(user: {
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

export async function ensureUserTenantContext(): Promise<UserTenantContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Fast path: most requests come from already-bootstrapped users, so do the
  // membership lookup without opening a transaction.
  const existing = await loadMembership(db, user.id);
  if (existing) {
    await ensureAppMetadataTenantId(user, existing.tenantId);
    return {
      user: {
        id: user.id,
        email: user.email ?? null,
        displayName: existing.displayName,
      },
      tenant: { id: existing.tenantId, name: existing.tenantName },
    };
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

    const raced = await loadMembership(tx, user.id);
    if (raced) {
      return {
        user: {
          id: user.id,
          email: user.email ?? null,
          displayName: raced.displayName,
        },
        tenant: { id: raced.tenantId, name: raced.tenantName },
      };
    }

    const [tenant] = await tx
      .insert(tenants)
      .values({ name: `Cuenta de ${displayName}` })
      .returning({ id: tenants.id, name: tenants.name });

    if (!tenant) {
      throw new Error("Unable to create tenant for authenticated user.");
    }

    await tx.insert(tenantUsers).values({
      tenantId: tenant.id,
      userId: user.id,
      displayName,
    });

    return {
      user: { id: user.id, email: user.email ?? null, displayName },
      tenant,
    };
  });

  // Persist the tenant_id claim on the auth user. Done after the tx commits
  // so a failed admin call rolls back the JWT update, not the membership.
  if (context.tenant) {
    await ensureAppMetadataTenantId(user, context.tenant.id);
  }

  return context;
}
