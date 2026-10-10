"use server";

import { randomBytes } from "crypto";
import { toActionResult, UserFacingError } from "@/lib/action-result";
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
import { requireUuid } from "@/lib/validation";

function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

const NO_ACTIVE_TENANT_MESSAGE = "No se encontró un puesto activo.";

// Expected failures come back as `{ ok: false, error }` (lib/action-result.ts).

/** `expectedTenantId` is the tenant the calling screen renders. */
export async function createInvitation(expectedTenantId: string) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      NO_ACTIVE_TENANT_MESSAGE
    );

    const origin = await getRequestOrigin();
    if (!origin) {
      throw new UserFacingError(INVITE_ORIGIN_UNAVAILABLE_MESSAGE);
    }

    const rawToken = generateInviteToken();
    // Always carries a token: an active link that cannot be shown again is
    // replaced (see getOrCreateActiveInvitation).
    const invitation = await getOrCreateActiveInvitation({
      tenantId: context.tenant.id,
      createdByUserId: context.user.id,
      token: rawToken,
      expiresAt: new Date(Date.now() + DEFAULT_INVITE_TTL_MS),
    });

    const link = buildInviteLink(origin, invitation.token);
    if (!link) {
      throw new UserFacingError(INVITE_ORIGIN_UNAVAILABLE_MESSAGE);
    }

    return {
      link,
      invitation,
    };
  });
}

export async function revokeInvitation(
  expectedTenantId: string,
  invitationId: string
) {
  return toActionResult(async () => {
    const context = await requireExpectedTenantContext(
      expectedTenantId,
      NO_ACTIVE_TENANT_MESSAGE
    );

    await revokeInvitationById(
      requireUuid(
        invitationId,
        "No se encontró la invitación o ya fue revocada."
      ),
      context.tenant.id
    );
  });
}

export async function acceptInvitation(token: string) {
  return toActionResult(async () => {
    const user = await getAuthenticatedUser();

    // The join page already gates unauthenticated users to /login; this is a
    // defensive guard. Fail (rather than redirect) so the calling client form
    // can surface the error instead of racing a server redirect against its
    // own post-accept navigation.
    if (!user) {
      throw new UserFacingError("Tu sesión expiró. Volvé a iniciar sesión.");
    }

    // Links carry a 43-character base64url token; anything else is no
    // invitation at all.
    if (typeof token !== "string" || !token || token.length > 256) {
      throw new UserFacingError("Esta invitación ya no es válida.");
    }

    const displayName = getDisplayName(user);

    // Validity check + membership write happen in one transaction (with the
    // invitation row locked) so a concurrent revoke/expiry can't slip between
    // "valid" and "joined". Only after the membership is durably committed do
    // we flip the active-tenant claim.
    const { tenantId } = await redeemInvitation(token, user.id, displayName);

    // The membership is already committed — joining succeeded. A failure
    // flipping the active-tenant claim must NOT surface as "accept failed"
    // (matching createTenant). The next ensureUserTenantContext on '/'
    // reconciles the claim.
    try {
      await setActiveTenantClaim(user, tenantId);
    } catch (error) {
      console.error("[acceptInvitation] setActiveTenantClaim failed", error);
    }
  });
}
