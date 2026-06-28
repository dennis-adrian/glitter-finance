import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantInvitations, tenants } from "@/lib/db/schema";
import type { TenantInvitation } from "@/lib/types";

export type InvitationWithTenant = TenantInvitation & {
  tenantName: string;
};

function mapInvitation(row: {
  id: string;
  tenantId: string;
  token: string;
  createdByUserId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}): TenantInvitation {
  return {
    id: row.id,
    tenantId: row.tenantId,
    token: row.token,
    createdByUserId: row.createdByUserId,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function isInvitationValid(invitation: TenantInvitation): boolean {
  if (invitation.revokedAt) {
    return false;
  }
  return new Date(invitation.expiresAt).getTime() > Date.now();
}

export async function getInvitationByToken(
  token: string
): Promise<InvitationWithTenant | null> {
  const [row] = await db
    .select({
      id: tenantInvitations.id,
      tenantId: tenantInvitations.tenantId,
      token: tenantInvitations.token,
      createdByUserId: tenantInvitations.createdByUserId,
      expiresAt: tenantInvitations.expiresAt,
      revokedAt: tenantInvitations.revokedAt,
      createdAt: tenantInvitations.createdAt,
      tenantName: tenants.name,
    })
    .from(tenantInvitations)
    .innerJoin(tenants, eq(tenantInvitations.tenantId, tenants.id))
    .where(eq(tenantInvitations.token, token))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    ...mapInvitation(row),
    tenantName: row.tenantName,
  };
}

export async function getActiveInvitationForTenant(
  tenantId: string
): Promise<TenantInvitation | null> {
  const now = new Date();
  const [row] = await db
    .select({
      id: tenantInvitations.id,
      tenantId: tenantInvitations.tenantId,
      token: tenantInvitations.token,
      createdByUserId: tenantInvitations.createdByUserId,
      expiresAt: tenantInvitations.expiresAt,
      revokedAt: tenantInvitations.revokedAt,
      createdAt: tenantInvitations.createdAt,
    })
    .from(tenantInvitations)
    .where(
      and(
        eq(tenantInvitations.tenantId, tenantId),
        isNull(tenantInvitations.revokedAt),
        gt(tenantInvitations.expiresAt, now)
      )
    )
    .orderBy(desc(tenantInvitations.createdAt))
    .limit(1);

  return row ? mapInvitation(row) : null;
}

export async function insertInvitation(input: {
  tenantId: string;
  token: string;
  createdByUserId: string;
  expiresAt: Date;
}): Promise<TenantInvitation> {
  const [row] = await db
    .insert(tenantInvitations)
    .values({
      tenantId: input.tenantId,
      token: input.token,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt,
    })
    .returning({
      id: tenantInvitations.id,
      tenantId: tenantInvitations.tenantId,
      token: tenantInvitations.token,
      createdByUserId: tenantInvitations.createdByUserId,
      expiresAt: tenantInvitations.expiresAt,
      revokedAt: tenantInvitations.revokedAt,
      createdAt: tenantInvitations.createdAt,
    });

  if (!row) {
    throw new Error("Unable to create invitation.");
  }

  return mapInvitation(row);
}

export async function revokeInvitationById(
  invitationId: string,
  tenantId: string
): Promise<void> {
  const revokedAt = new Date();
  const result = await db
    .update(tenantInvitations)
    .set({ revokedAt })
    .where(
      and(
        eq(tenantInvitations.id, invitationId),
        eq(tenantInvitations.tenantId, tenantId),
        isNull(tenantInvitations.revokedAt)
      )
    )
    .returning({ id: tenantInvitations.id });

  if (!result.length) {
    throw new Error("Invitation not found or already revoked.");
  }
}
