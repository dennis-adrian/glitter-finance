"use server";

import { randomBytes } from "crypto";
import { headers } from "next/headers";
import {
  ensureMembership,
  ensureUserTenantContext,
  getDisplayName,
  setActiveTenantClaim,
} from "@/lib/auth/user-context";
import { db } from "@/lib/db";
import { DEFAULT_INVITE_TTL_MS } from "@/lib/invitations/constants";
import {
  getActiveInvitationForTenant,
  getInvitationByToken,
  insertInvitation,
  isInvitationValid,
  revokeInvitationById,
} from "@/lib/invitations/repository";
import { createClient } from "@/lib/supabase/server";

function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

async function getRequestOrigin() {
  const headerStore = await headers();
  return (
    headerStore.get("origin") ??
    `https://${headerStore.get("x-forwarded-host") ?? headerStore.get("host")}`
  );
}

export async function createInvitation() {
  const context = await ensureUserTenantContext();
  if (!context?.tenant) {
    throw new Error("No active account found.");
  }

  const origin = await getRequestOrigin();

  // Reuse the current active link instead of stacking up valid invitations for
  // the same tenant (the UI hides "Generar" while one is active, but a second
  // device or a stale tab could still get here).
  const existing = await getActiveInvitationForTenant(context.tenant.id);
  if (existing) {
    return {
      link: `${origin}/join/${existing.token}`,
      invitation: existing,
    };
  }

  const expiresAt = new Date(Date.now() + DEFAULT_INVITE_TTL_MS);
  const invitation = await insertInvitation({
    tenantId: context.tenant.id,
    token: generateInviteToken(),
    createdByUserId: context.user.id,
    expiresAt,
  });

  return {
    link: `${origin}/join/${invitation.token}`,
    invitation,
  };
}

export async function revokeInvitation(invitationId: string) {
  const context = await ensureUserTenantContext();
  if (!context?.tenant) {
    throw new Error("No active account found.");
  }

  await revokeInvitationById(invitationId, context.tenant.id);
}

export async function acceptInvitation(token: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The join page already gates unauthenticated users to /login; this is a
  // defensive guard. Throw (rather than redirect) so the calling client form
  // can surface the error instead of racing a server redirect against its own
  // post-accept navigation.
  if (!user) {
    throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  }

  const invitation = await getInvitationByToken(token);
  if (!invitation || !isInvitationValid(invitation)) {
    throw new Error("Esta invitación ya no es válida.");
  }

  const displayName = getDisplayName({
    email: user.email,
    user_metadata: user.user_metadata,
  });

  await ensureMembership(db, {
    tenantId: invitation.tenantId,
    userId: user.id,
    displayName,
  });
  await setActiveTenantClaim(user, invitation.tenantId);
}
