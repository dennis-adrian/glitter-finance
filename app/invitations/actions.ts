"use server";

import { randomBytes } from "crypto";
import {
  ensureUserTenantContext,
  getDisplayName,
  setActiveTenantClaim,
} from "@/lib/auth/user-context";
import { DEFAULT_INVITE_TTL_MS } from "@/lib/invitations/constants";
import {
  getOrCreateActiveInvitation,
  redeemInvitation,
  revokeInvitationById,
} from "@/lib/invitations/repository";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

export async function createInvitation() {
  const context = await ensureUserTenantContext();
  if (!context?.tenant) {
    throw new Error("No active account found.");
  }

  const origin = await getRequestOrigin();

  const rawToken = generateInviteToken();
  let invitation = await getOrCreateActiveInvitation({
    tenantId: context.tenant.id,
    createdByUserId: context.user.id,
    token: rawToken,
    expiresAt: new Date(Date.now() + DEFAULT_INVITE_TTL_MS),
  });

  // Active invitations store only a hash; rotate when we cannot recover the
  // bearer token for link delivery (existing row from a prior session/device).
  if (!invitation.token) {
    await revokeInvitationById(invitation.id, context.tenant.id);
    const freshToken = generateInviteToken();
    invitation = await getOrCreateActiveInvitation({
      tenantId: context.tenant.id,
      createdByUserId: context.user.id,
      token: freshToken,
      expiresAt: new Date(Date.now() + DEFAULT_INVITE_TTL_MS),
    });
  }

  if (!invitation.token) {
    throw new Error("No se pudo generar el enlace de invitación.");
  }

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

  const displayName = getDisplayName({
    email: user.email,
    user_metadata: user.user_metadata,
  });

  // Validity check + membership write happen in one transaction (with the
  // invitation row locked) so a concurrent revoke/expiry can't slip between
  // "valid" and "joined". Only after the membership is durably committed do we
  // flip the active-tenant claim.
  const { tenantId } = await redeemInvitation(token, user.id, displayName);

  // The membership is already committed — joining succeeded. A failure flipping
  // the active-tenant claim must NOT surface as "accept failed" (matching
  // createTenant). The next ensureUserTenantContext reconciles the claim.
  try {
    await setActiveTenantClaim(user, tenantId);
  } catch (error) {
    console.error("[acceptInvitation] setActiveTenantClaim failed", error);
  }
}
