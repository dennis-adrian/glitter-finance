import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { ensureMembership } from "@/lib/auth/user-context";
import { db } from "@/lib/db";
import { tenantInvitations, tenants } from "@/lib/db/schema";
import {
  decryptInvitationDeliveryToken,
  encryptInvitationDeliveryToken,
  hashInvitationToken,
} from "@/lib/invitations/token";
import { isInvitationValid } from "@/lib/invitations/validation";
import type { TenantInvitation } from "@/lib/types";

export { isInvitationValid };

export type InvitationWithTenant = TenantInvitation & {
  tenantName: string;
};

function deliveryTokenFromRow(row: {
  tokenDeliveryCiphertext: string | null;
}): string | undefined {
  if (!row.tokenDeliveryCiphertext) {
    return undefined;
  }
  return (
    decryptInvitationDeliveryToken(row.tokenDeliveryCiphertext) ?? undefined
  );
}

function mapInvitation(
  row: {
    id: string;
    tenantId: string;
    token: string;
    tokenDeliveryCiphertext: string | null;
    createdByUserId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  },
  deliveryToken?: string
): TenantInvitation {
  return {
    id: row.id,
    tenantId: row.tenantId,
    token: deliveryToken ?? "",
    createdByUserId: row.createdByUserId,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// Atomically validate an invitation and create the membership. The invitation
// row is locked FOR UPDATE so a concurrent revoke (which UPDATEs the same row)
// serializes behind us: either we join while it is still valid, or we observe
// the revoke/expiry and reject. Returns the tenant the caller just joined.
export async function redeemInvitation(
  token: string,
  userId: string,
  displayName: string
): Promise<{ tenantId: string }> {
  const tokenHash = hashInvitationToken(token);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        tenantId: tenantInvitations.tenantId,
        expiresAt: tenantInvitations.expiresAt,
        revokedAt: tenantInvitations.revokedAt,
      })
      .from(tenantInvitations)
      .where(eq(tenantInvitations.token, tokenHash))
      .for("update")
      .limit(1);

    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new Error("Esta invitación ya no es válida.");
    }

    await ensureMembership(tx, {
      tenantId: row.tenantId,
      userId,
      displayName,
    });

    return { tenantId: row.tenantId };
  });
}

export async function getInvitationByToken(
  token: string
): Promise<InvitationWithTenant | null> {
  const tokenHash = hashInvitationToken(token);
  const [row] = await db
    .select({
      id: tenantInvitations.id,
      tenantId: tenantInvitations.tenantId,
      token: tenantInvitations.token,
      tokenDeliveryCiphertext: tenantInvitations.tokenDeliveryCiphertext,
      createdByUserId: tenantInvitations.createdByUserId,
      expiresAt: tenantInvitations.expiresAt,
      revokedAt: tenantInvitations.revokedAt,
      createdAt: tenantInvitations.createdAt,
      tenantName: tenants.name,
    })
    .from(tenantInvitations)
    .innerJoin(tenants, eq(tenantInvitations.tenantId, tenants.id))
    .where(eq(tenantInvitations.token, tokenHash))
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
      tokenDeliveryCiphertext: tenantInvitations.tokenDeliveryCiphertext,
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

  if (!row) {
    return null;
  }
  const deliveryToken = deliveryTokenFromRow(row);
  if (!deliveryToken) {
    return null;
  }
  return mapInvitation(row, deliveryToken);
}

const invitationColumns = {
  id: tenantInvitations.id,
  tenantId: tenantInvitations.tenantId,
  token: tenantInvitations.token,
  tokenDeliveryCiphertext: tenantInvitations.tokenDeliveryCiphertext,
  createdByUserId: tenantInvitations.createdByUserId,
  expiresAt: tenantInvitations.expiresAt,
  revokedAt: tenantInvitations.revokedAt,
  createdAt: tenantInvitations.createdAt,
};

// Returns the tenant's current active invitation, creating one (with the
// supplied candidate token/expiry) only if none exists. A per-tenant advisory
// lock serializes concurrent generators so two requests can't each insert a
// fresh valid link — they reuse the single active one instead. Mirrors the
// bootstrap advisory-lock pattern in lib/auth/user-context.ts.
export async function getOrCreateActiveInvitation(input: {
  tenantId: string;
  createdByUserId: string;
  token: string;
  expiresAt: Date;
}): Promise<TenantInvitation> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"invitation_create:" + input.tenantId}))`
    );

    const [existing] = await tx
      .select(invitationColumns)
      .from(tenantInvitations)
      .where(
        and(
          eq(tenantInvitations.tenantId, input.tenantId),
          isNull(tenantInvitations.revokedAt),
          gt(tenantInvitations.expiresAt, new Date())
        )
      )
      .orderBy(desc(tenantInvitations.createdAt))
      .limit(1);

    if (existing) {
      const deliveryToken = deliveryTokenFromRow(existing);
      if (deliveryToken) {
        return mapInvitation(existing, deliveryToken);
      }

      // Active row but undeliverable token (missing ciphertext or decrypt
      // failure). Revoke before inserting a replacement so two valid links
      // cannot coexist for the same tenant.
      await tx
        .update(tenantInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(tenantInvitations.id, existing.id),
            isNull(tenantInvitations.revokedAt)
          )
        );
    }

    const [row] = await tx
      .insert(tenantInvitations)
      .values({
        tenantId: input.tenantId,
        token: hashInvitationToken(input.token),
        tokenDeliveryCiphertext: encryptInvitationDeliveryToken(input.token),
        createdByUserId: input.createdByUserId,
        expiresAt: input.expiresAt,
      })
      .returning(invitationColumns);

    if (!row) {
      throw new Error("Unable to create invitation.");
    }

    return mapInvitation(row, input.token);
  });
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
