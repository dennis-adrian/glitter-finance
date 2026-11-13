// Noticing a lost membership on a device (lib/powersync/tenant-access.ts and
// SupabaseConnector.verifyTenantAccess).

import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseConnector } from "@/lib/powersync/connector";
import {
  createTenantAccessCheck,
  type TenantAccess,
} from "@/lib/powersync/tenant-access";
import { TenantAccessRemovedError } from "@/lib/powersync/tenant-claim";

function checkWith(answers: TenantAccess[]) {
  let time = 0;
  const calls: number[] = [];
  let removed = 0;
  const check = createTenantAccessCheck({
    verify: async () => {
      calls.push(time);
      return answers.shift() ?? "member";
    },
    onRemoved: () => {
      removed += 1;
    },
    minIntervalMs: 1000,
    now: () => time,
  });
  return {
    check,
    calls,
    removed: () => removed,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test("a membership row present locally never asks the server", async () => {
  const subject = checkWith([]);

  await subject.check(1);

  assert.deepEqual(subject.calls, []);
});

test("a missing row asks the server, and only a confirmed removal is reported", async () => {
  const subject = checkWith(["member", "unknown", "removed"]);

  await subject.check(0);
  assert.equal(subject.removed(), 0);
  subject.advance(1000);
  await subject.check(0);
  assert.equal(subject.removed(), 0);
  subject.advance(1000);
  await subject.check(0);
  assert.equal(subject.removed(), 1);

  subject.advance(1000);
  await subject.check(0);
  assert.equal(subject.calls.length, 3, "nothing is asked once removed");
  assert.equal(subject.removed(), 1);
});

test("the server is asked at most once per interval", async () => {
  const subject = checkWith(["member", "member"]);

  await subject.check(0);
  subject.advance(500);
  await subject.check(0);
  assert.equal(subject.calls.length, 1);
  subject.advance(500);
  await subject.check(0);
  assert.equal(subject.calls.length, 2);
});

test("a failed check is not a removal", async () => {
  const warn = console.warn;
  console.warn = () => {};
  let removed = false;
  try {
    const check = createTenantAccessCheck({
      verify: async () => {
        throw new Error("offline");
      },
      onRemoved: () => {
        removed = true;
      },
    });
    await check(0);
  } finally {
    console.warn = warn;
  }
  assert.equal(removed, false);
});

// --- SupabaseConnector ------------------------------------------------------

function accessToken(tenantId: string | null) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "none" }),
    encode({ app_metadata: tenantId ? { tenant_id: tenantId } : {} }),
    "signature",
  ].join(".");
}

function supabaseWith(input: {
  token: string;
  refreshedToken?: string;
  memberships: { tenant_id: string; user_id: string }[] | "error";
  queries: string[];
}) {
  const session = (token: string) => ({
    access_token: token,
    expires_at: 2_000_000_000,
    user: { id: "user-1" },
  });
  return {
    auth: {
      getSession: async () => ({
        data: { session: session(input.token) },
        error: null,
      }),
      refreshSession: async () => ({
        data: { session: session(input.refreshedToken ?? input.token) },
        error: null,
      }),
    },
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        limit: async () => {
          input.queries.push(`${table}:${JSON.stringify(filters)}`);
          if (input.memberships === "error") {
            return { data: null, error: { message: "offline" } };
          }
          return {
            data: input.memberships.filter(
              (row) =>
                row.tenant_id === filters.tenant_id &&
                row.user_id === filters.user_id
            ),
            error: null,
          };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function withPublicEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "publishable-key";
}

test("the connector reads the user's own membership row", async () => {
  const queries: string[] = [];
  let removed = 0;
  const member = new SupabaseConnector(
    supabaseWith({
      token: accessToken("tenant-1"),
      memberships: [{ tenant_id: "tenant-1", user_id: "user-1" }],
      queries,
    }),
    "tenant-1",
    { onAccessRemoved: () => (removed += 1) }
  );
  assert.equal(await member.verifyTenantAccess(), "member");
  assert.deepEqual(queries, [
    'tenant_users:{"tenant_id":"tenant-1","user_id":"user-1"}',
  ]);

  const unreachable = new SupabaseConnector(
    supabaseWith({
      token: accessToken("tenant-1"),
      memberships: "error",
      queries,
    }),
    "tenant-1",
    { onAccessRemoved: () => (removed += 1) }
  );
  assert.equal(await unreachable.verifyTenantAccess(), "unknown");
  assert.equal(removed, 0);
});

test("a confirmed removal is reported once and stops the sync for good", async () => {
  withPublicEnv();
  const queries: string[] = [];
  let removed = 0;
  const connector = new SupabaseConnector(
    supabaseWith({
      token: accessToken("tenant-1"),
      memberships: [],
      queries,
    }),
    "tenant-1",
    { onAccessRemoved: () => (removed += 1) }
  );

  assert.equal(await connector.verifyTenantAccess(), "removed");
  assert.equal(await connector.verifyTenantAccess(), "removed");
  assert.equal(removed, 1);
  assert.equal(queries.length, 1);
  await assert.rejects(connector.fetchCredentials(), TenantAccessRemovedError);
});

test("a refreshed token that no longer claims the tenant is checked against the membership", async () => {
  withPublicEnv();
  const queries: string[] = [];
  let removed = 0;
  const connector = new SupabaseConnector(
    supabaseWith({
      token: accessToken("tenant-1"),
      // The removal cleared the claim: the user has no other tenant.
      refreshedToken: accessToken(null),
      memberships: [],
      queries,
    }),
    "tenant-1",
    { onAccessRemoved: () => (removed += 1) }
  );
  const warn = console.warn;
  console.warn = () => {};
  try {
    // The cached token still claims the tenant: nothing to check yet.
    assert.ok(await connector.fetchCredentials());
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(queries, []);

  const stale = new SupabaseConnector(
    supabaseWith({
      token: accessToken("tenant-2"),
      refreshedToken: accessToken("tenant-2"),
      memberships: [],
      queries,
    }),
    "tenant-1",
    { onAccessRemoved: () => (removed += 1) }
  );
  console.warn = () => {};
  try {
    await assert.rejects(stale.fetchCredentials(), TenantAccessRemovedError);
  } finally {
    console.warn = warn;
  }
  assert.equal(removed, 1);
});

test("a tenant change on another device stays a tenant change while the user is still a member", async () => {
  withPublicEnv();
  const queries: string[] = [];
  const connector = new SupabaseConnector(
    supabaseWith({
      token: accessToken("tenant-2"),
      refreshedToken: accessToken("tenant-2"),
      memberships: [{ tenant_id: "tenant-1", user_id: "user-1" }],
      queries,
    }),
    "tenant-1"
  );
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(connector.fetchCredentials(), {
      name: "ActiveTenantChangedError",
    });
  } finally {
    console.warn = warn;
  }
});

test("a connect without any session is reported, so the app can say the session ended", async () => {
  withPublicEnv();
  let missing = 0;
  const connector = new SupabaseConnector(
    {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
      },
    } as unknown as SupabaseClient,
    "tenant-1",
    { onSessionMissing: () => (missing += 1) }
  );

  assert.equal(await connector.fetchCredentials(), null);
  assert.equal(missing, 1);
});
