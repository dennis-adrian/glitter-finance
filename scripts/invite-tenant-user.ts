// Provisions an additional auth user on an existing tenant for closed testing.
// Each invited user signs in on their own device and records sales against the
// shared tenant; PowerSync sync rules scope replication by app_metadata.tenant_id.
//
// Required env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SECRET_KEY
//   DATABASE_URL
//   TENANT_ID              target tenant uuid
//   INVITE_EMAIL           login email for the new member
//   INVITE_PASSWORD        login password
//   INVITE_DISPLAY_NAME    optional display name (defaults from email local-part)
//
// Usage:
//   TENANT_ID=... INVITE_EMAIL=helper@example.com INVITE_PASSWORD=... \
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
//   npm run db:invite:tenant-user
import "./load-env";

import { and, eq } from "drizzle-orm";
import type { User } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { db } from "@/lib/db";
import { tenantUsers, tenants } from "@/lib/db/schema";
import { findAuthUserByEmail } from "./admin-auth";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createAdminClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws as unknown as never },
    }
  );
}

function defaultDisplayName(email: string) {
  const local = email.split("@")[0]?.trim();
  return local || "Vendedor";
}

async function assertUserCanJoinTenant(userId: string, tenantId: string) {
  const memberships = await db
    .select({ tenantId: tenantUsers.tenantId })
    .from(tenantUsers)
    .where(eq(tenantUsers.userId, userId));

  const conflicting = memberships.find((m) => m.tenantId !== tenantId);
  if (conflicting) {
    throw new Error(
      `User already belongs to tenant ${conflicting.tenantId}. ` +
        "Remove that membership first before inviting to another tenant."
    );
  }
}

async function updateAuthUserForInvite(
  user: User,
  password: string,
  displayName: string
) {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    user_metadata: {
      ...(user.user_metadata ?? {}),
      display_name: displayName,
    },
  });
  if (error) {
    throw new Error(`Could not update invited user: ${error.message}`);
  }
  return { id: user.id, created: false };
}

async function createAuthUserForInvite(
  email: string,
  password: string,
  displayName: string
) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) {
    throw new Error(
      `Could not create invited user: ${error?.message ?? "unknown"}`
    );
  }
  return { id: data.user.id, created: true };
}

async function ensureTenantExists(tenantId: string) {
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new Error(`Tenant ${tenantId} was not found.`);
  }

  return tenant;
}

async function ensureMembership(input: {
  tenantId: string;
  userId: string;
  displayName: string;
}) {
  const [existingMembership] = await db
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, input.tenantId),
        eq(tenantUsers.userId, input.userId)
      )
    )
    .limit(1);

  if (existingMembership) {
    await db
      .update(tenantUsers)
      .set({ displayName: input.displayName })
      .where(eq(tenantUsers.id, existingMembership.id));
    return { created: false };
  }

  await db.insert(tenantUsers).values({
    tenantId: input.tenantId,
    userId: input.userId,
    displayName: input.displayName,
  });
  return { created: true };
}

async function setTenantClaim(userId: string, tenantId: string) {
  const admin = createAdminClient();
  const { data, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError || !data.user) {
    throw new Error(
      `Could not load invited user for metadata update: ${getError?.message ?? "unknown"}`
    );
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...(data.user.app_metadata ?? {}),
      tenant_id: tenantId,
    },
  });
  if (error) {
    throw new Error(`Could not set tenant_id on invited user: ${error.message}`);
  }
}

async function main() {
  const tenantId = requireEnv("TENANT_ID");
  const email = requireEnv("INVITE_EMAIL");
  const password = requireEnv("INVITE_PASSWORD");
  const displayName =
    process.env.INVITE_DISPLAY_NAME?.trim() || defaultDisplayName(email);

  const tenant = await ensureTenantExists(tenantId);
  const admin = createAdminClient();
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) {
    await assertUserCanJoinTenant(existing.id, tenantId);
  }

  const authUser = existing
    ? await updateAuthUserForInvite(existing, password, displayName)
    : await createAuthUserForInvite(email, password, displayName);

  const membership = await ensureMembership({
    tenantId,
    userId: authUser.id,
    displayName,
  });
  await setTenantClaim(authUser.id, tenantId);

  console.log("Invited tenant member:");
  console.log(`  tenant: ${tenant.name} (${tenant.id})`);
  console.log(`  display name: ${displayName}`);
  console.log(`  auth user: ${authUser.id} (${authUser.created ? "created" : "existing"})`);
  console.log(
    `  membership: ${membership.created ? "created" : "updated existing"}`
  );
  console.log("");
  console.log(
    "The invited user must sign in again (or refresh their session) so the JWT picks up app_metadata.tenant_id."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    // postgres.js pool used by lib/db keeps the event loop alive.
    process.exit(0);
  });
