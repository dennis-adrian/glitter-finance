// Invitation validity, on the Settings card (lib/invitations/validation.ts)
// and where it counts, when a link is redeemed (redeemInvitation in
// lib/invitations/repository.ts, run against a stand-in for Drizzle).

import assert from "node:assert/strict";
import test from "node:test";
import { UserFacingError } from "@/lib/action-result";
import {
  buildInviteLink,
  isAbsoluteHttpUrl,
  isInvitationValid,
} from "@/lib/invitations/validation";
import type { TenantInvitation } from "@/lib/types";
import { stubModule } from "./support/stub-module";

stubModule("server-only", {});

const HOUR_MS = 60 * 60 * 1000;
const TENANT_ID = "70000000-0000-4000-8000-000000000001";

function invitation(overrides: Partial<TenantInvitation>): TenantInvitation {
  return {
    id: "invitation-1",
    tenantId: TENANT_ID,
    token: "token",
    createdByUserId: "user-1",
    expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
    revokedAt: null,
    createdAt: new Date(Date.now() - HOUR_MS).toISOString(),
    ...overrides,
  };
}

test("an invitation is valid until it expires or is revoked", () => {
  assert.equal(isInvitationValid(invitation({})), true);
  assert.equal(
    isInvitationValid(
      invitation({ revokedAt: new Date(Date.now() - 1000).toISOString() })
    ),
    false
  );
  assert.equal(
    isInvitationValid(
      invitation({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    ),
    false
  );
  assert.equal(
    isInvitationValid(invitation({ expiresAt: new Date().toISOString() })),
    false,
    "the expiry instant itself is already expired"
  );
});

test("invite links are built only on an absolute http(s) origin", () => {
  assert.equal(
    buildInviteLink(" https://pos.example.com// ", "abc"),
    "https://pos.example.com/join/abc"
  );
  assert.equal(
    buildInviteLink("http://localhost:3000", "abc"),
    "http://localhost:3000/join/abc"
  );
  for (const origin of [
    "",
    "   ",
    "/app",
    "pos.example.com",
    "javascript:alert(1)",
  ]) {
    assert.equal(buildInviteLink(origin, "abc"), "", origin);
  }
  assert.equal(buildInviteLink("https://pos.example.com", ""), "");

  assert.equal(isAbsoluteHttpUrl("https://pos.example.com/join/abc"), true);
  assert.equal(isAbsoluteHttpUrl("ftp://pos.example.com"), false);
  assert.equal(isAbsoluteHttpUrl("/join/abc"), false);
});

// ---------------------------------------------------------------------------
// Redeeming a link
// ---------------------------------------------------------------------------

type InvitationRow = {
  tenantId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** A Drizzle query builder that resolves to `result` whatever is chained. */
function query(result: unknown): unknown {
  const builder: unknown = new Proxy(() => builder, {
    get(_target, property) {
      if (property === "then") {
        return (
          resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return () => builder;
    },
  });
  return builder;
}

let storedInvitation: InvitationRow | undefined;
let membershipExists = false;
const insertedMemberships: unknown[] = [];

const fakeDb = {
  transaction: async <T>(run: (tx: unknown) => Promise<T>) =>
    run({
      select: () => query(storedInvitation ? [storedInvitation] : []),
      insert: () => ({
        values: (values: unknown) => {
          insertedMemberships.push(values);
          return query(membershipExists ? [] : [{ id: "membership-1" }]);
        },
      }),
    }),
};

async function redeem(row: InvitationRow | undefined, userId = "user-2") {
  storedInvitation = row;
  insertedMemberships.length = 0;
  // lib/db reads its Drizzle instance from this global when one is set.
  Object.assign(globalThis, { glitterDb: fakeDb, glitterPostgres: {} });
  Object.assign(process.env, {
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/unused",
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "publishable-key",
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "secret-key",
    INVITATION_SECRET_KEY: process.env.INVITATION_SECRET_KEY ?? "invite-key",
  });
  const { redeemInvitation } = await import("@/lib/invitations/repository");
  return redeemInvitation("raw-token", userId, "Ayudante");
}

const openRow = () => ({
  tenantId: TENANT_ID,
  expiresAt: new Date(Date.now() + HOUR_MS),
  revokedAt: null,
});

test("redeeming a valid link adds the user to its tenant", async () => {
  assert.deepEqual(await redeem(openRow()), { tenantId: TENANT_ID });
  assert.deepEqual(insertedMemberships, [
    { tenantId: TENANT_ID, userId: "user-2", displayName: "Ayudante" },
  ]);
});

test("a link admits several people, and a member again, until it ends", async () => {
  assert.deepEqual(await redeem(openRow(), "user-3"), { tenantId: TENANT_ID });
  membershipExists = true;
  try {
    assert.deepEqual(await redeem(openRow(), "user-3"), {
      tenantId: TENANT_ID,
    });
  } finally {
    membershipExists = false;
  }
});

test("a revoked, expired or unknown link adds nobody", async () => {
  for (const row of [
    { ...openRow(), revokedAt: new Date(Date.now() - 1000) },
    { ...openRow(), expiresAt: new Date(Date.now() - 1000) },
    undefined,
  ]) {
    await assert.rejects(
      () => redeem(row),
      (error) =>
        error instanceof UserFacingError &&
        error.message === "Esta invitación ya no es válida."
    );
    assert.deepEqual(insertedMemberships, []);
  }
});
