"use server";

import { randomBytes } from "crypto";
import { getDisplayName } from "@/lib/auth/tenant-context";
import {
  getAuthenticatedUser,
  requireExpectedTenantContext,
  setActiveTenantClaim,
} from "@/lib/auth/user-context";
import { DEFAULT_INVITE_TTL_MS } from "@/lib/invitations/constants";
import {
  getOrCreateActiveInvitation,
  redeemInvitation,
  revokeInvitationById,
} from "@/lib/invitations/repository";
import {
  INVITE_ORIGIN_UNAVAILABLE_MESSAGE,
  buildInviteLink,
} from "@/lib/invitations/validation";
import { getRequestOrigin } from "@/lib/request-origin";

function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

const NO_ACTIVE_TENANT_MESSAGE = "No se encontró una cuenta activa.";

/** `expectedTenantId` is the tenant the calling screen renders. */
export async function createInvitation(expectedTenantId: string) {
  const context = await requireExpectedTenantContext(
    expectedTenantId,
    NO_ACTIVE_TENANT_MESSAGE
  );

  const origin = await getRequestOrigin();
  if (!origin) {
    throw new Error(INVITE_ORIGIN_UNAVAILABLE_MESSAGE);
  }

  const rawToken = generateInviteToken();
  const invitation = await getOrCreateActiveInvitation({
    tenantId: context.tenant.id,
    createdByUserId: context.user.id,
    token: rawToken,
    expiresAt: new Date(Date.now() + DEFAULT_INVITE_TTL_MS),
  });

  if (!invitation.token) {
    throw new Error(
      "Ya hay un enlace activo, pero no se puede recuperar. Revócalo y genera uno nuevo."
    );
  }

  const link = buildInviteLink(origin, invitation.token);
  if (!link) {
    throw new Error(INVITE_ORIGIN_UNAVAILABLE_MESSAGE);
  }

  return {
    link,
    invitation,
  };
}

export async function revokeInvitation(
  expectedTenantId: string,
  invitationId: string
) {
  const context = await requireExpectedTenantContext(
    expectedTenantId,
    NO_ACTIVE_TENANT_MESSAGE
  );

  await revokeInvitationById(invitationId, context.tenant.id);
}

export async function acceptInvitation(token: string) {
  const user = await getAuthenticatedUser();

  // The join page already gates unauthenticated users to /login; this is a
  // defensive guard. Throw (rather than redirect) so the calling client form
  // can surface the error instead of racing a server redirect against its own
  // post-accept navigation.
  if (!user) {
    throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  }

  const displayName = getDisplayName(user);

  // Validity check + membership write happen in one transaction (with the
  // invitation row locked) so a concurrent revoke/expiry can't slip between
  // "valid" and "joined". Only after the membership is durably committed do we
  // flip the active-tenant claim.
  const { tenantId } = await redeemInvitation(token, user.id, displayName);

  // The membership is already committed — joining succeeded. A failure flipping
  // the active-tenant claim must NOT surface as "accept failed" (matching
  // createTenant). The next ensureUserTenantContext on '/' reconciles the claim.
  try {
    await setActiveTenantClaim(user, tenantId);
  } catch (error) {
    console.error("[acceptInvitation] setActiveTenantClaim failed", error);
  }
}
