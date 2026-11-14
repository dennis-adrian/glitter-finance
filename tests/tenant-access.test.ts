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
    // The retry after an unknown answer has its own test below.
    schedule: () => () => {},
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

test("a change inside the interval is asked about once the interval has passed", async () => {
  const answers: TenantAccess[] = ["member", "removed"];
  const timers: { run: () => void; ms: number }[] = [];
  let time = 0;
  let removed = 0;
  const check = createTenantAccessCheck({
    verify: async () => answers.shift() ?? "member",
    onRemoved: () => {
      removed += 1;
    },
    minIntervalMs: 1000,
    now: () => time,
    schedule: (run, ms) => {
      timers.push({ run, ms });
      return () => {};
    },
  });

  // Still a member; then the table changes again 400 ms later (the removal)
  // and never after that, since the tenant stays empty.
  await check(0);
  time = 400;
  await check(0);
  await check(0);
  assert.deepEqual(
    timers.map((timer) => timer.ms),
    [600],
    "one check is scheduled for the rest of the interval"
  );

  time = 1000;
  timers[0].run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removed, 1);
});

test("a failed check is not a removal", async () => {
  const warn = console.warn;
  console.warn = () => {};
  let removed = false;
  let retries = 0;
  try {
    const check = createTenantAccessCheck({
      verify: async () => {
        throw new Error("offline");
      },
      onRemoved: () => {
        removed = true;
      },
      schedule: () => {
        retries += 1;
        return () => {};
      },
    });
    await check(0);
  } finally {
    console.warn = warn;
  }
  assert.equal(removed, false);
  assert.equal(retries, 1, "it is asked again later");
});

test("an unknown answer is asked again while the row stays missing, until the server confirms", async () => {
  const answers: TenantAccess[] = ["unknown", "unknown", "removed"];
  const timers: (() => void)[] = [];
  let time = 0;
  let verified = 0;
  let removed = 0;
  const check = createTenantAccessCheck({
    verify: async () => {
      verified += 1;
      return answers.shift() ?? "member";
    },
    onRemoved: () => {
      removed += 1;
    },
    minIntervalMs: 1000,
    now: () => time,
    schedule: (run, ms) => {
      assert.equal(ms, 1000);
      timers.push(() => {
        time += ms;
        run();
      });
      return () => {};
    },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  // Offline: the server cannot answer, and the watch never fires again.
  await check(0);
  assert.equal(verified, 1);
  assert.equal(timers.length, 1, "another check is scheduled");

  timers.shift()?.();
  await flush();
  assert.equal(verified, 2);
  assert.equal(removed, 0);

  // Back online, with the same (still missing) membership row.
  timers.shift()?.();
  await flush();
  assert.equal(verified, 3);
  assert.equal(removed, 1);
  assert.equal(timers.length, 0, "nothing is scheduled once removed");
});

test("a row that comes back, or a cleanup, stops the scheduled check", async () => {
  const timers: { run: () => void; cancelled: boolean }[] = [];
  let verified = 0;
  const make = () =>
    createTenantAccessCheck({
      verify: async () => {
        verified += 1;
        return "unknown";
      },
      onRemoved: () => {},
      minIntervalMs: 0,
      schedule: (run) => {
        const timer = { run, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });

  const synced = make();
  await synced(0);
  await synced(1);
  assert.equal(timers[0].cancelled, true);

  const disposed = make();
  await disposed(0);
  disposed.dispose();
  assert.equal(timers[1].cancelled, true);
  assert.equal(verified, 2);
});

test("a missing row that arrives while a check is answering 'member' is checked again", async () => {
  const timers: { run: () => void; ms: number }[] = [];
  const verifications: ((access: TenantAccess) => void)[] = [];
  let removed = 0;
  let time = 0;
  const check = createTenantAccessCheck({
    // Deferred: each check waits until the test answers it.
    verify: () =>
      new Promise<TenantAccess>((resolve) => verifications.push(resolve)),
    onRemoved: () => {
      removed += 1;
    },
    minIntervalMs: 1000,
    now: () => time,
    schedule: (run, ms) => {
      timers.push({ run, ms });
      return () => {};
    },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  // The row goes missing and the server is asked; it reads the membership
  // just before the owner deletes it.
  const first = check(0);
  await flush();
  assert.equal(verifications.length, 1);
  // The sync then drops the tenant: another missing-row notification while
  // the check is still answering.
  void check(0);
  verifications[0]("member");
  await first;

  assert.equal(removed, 0);
  assert.deepEqual(
    timers.map(({ ms }) => ms),
    [1000],
    "the outdated 'member' answer leads to another check"
  );

  time += 1000;
  timers[0].run();
  await flush();
  assert.equal(verifications.length, 2);
  verifications[1]("removed");
  await flush();
  assert.equal(removed, 1);
});

test("a 'member' answer with nothing changed meanwhile, or with the row back, schedules nothing", async () => {
  const timers: (() => void)[] = [];
  const verifications: ((access: TenantAccess) => void)[] = [];
  const check = createTenantAccessCheck({
    verify: () =>
      new Promise<TenantAccess>((resolve) => verifications.push(resolve)),
    onRemoved: () => {},
    minIntervalMs: 1000,
    now: () => 0,
    schedule: (run) => {
      timers.push(run);
      return () => {};
    },
  });

  const quiet = check(0);
  verifications[0]("member");
  await quiet;
  assert.equal(timers.length, 0, "a legacy database without the row");

  const restored = createTenantAccessCheck({
    verify: () =>
      new Promise<TenantAccess>((resolve) => verifications.push(resolve)),
    onRemoved: () => {},
    minIntervalMs: 1000,
    now: () => 0,
    schedule: (run) => {
      timers.push(run);
      return () => {};
    },
  });
  const pending = restored(0);
  void restored(1);
  verifications[1]("member");
  await pending;
  assert.equal(timers.length, 0, "the row came back while it was asked");
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

test("another account's session says nothing about the membership", async () => {
  const queries: string[] = [];
  let removed = 0;
  const connector = new SupabaseConnector(
    supabaseWith({
      token: accessToken("tenant-2"),
      memberships: [],
      queries,
    }),
    "tenant-1",
    { expectedUserId: "user-0", onAccessRemoved: () => (removed += 1) }
  );
  assert.equal(await connector.verifyTenantAccess(), "unknown");
  assert.deepEqual(queries, []);
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

test("an empty answer after the session ended is not a removal", async () => {
  const queries: string[] = [];
  let removed = 0;
  const supabase = supabaseWith({
    token: accessToken("tenant-1"),
    memberships: [],
    queries,
  });
  // The session ends while the membership query is on its way: the query
  // then ran as anon, which RLS shows no rows either.
  const signedIn = supabase.auth.getSession;
  let reads = 0;
  supabase.auth.getSession = (async () => {
    reads += 1;
    return reads === 1 ? signedIn() : { data: { session: null }, error: null };
  }) as typeof supabase.auth.getSession;
  const connector = new SupabaseConnector(supabase, "tenant-1", {
    onAccessRemoved: () => (removed += 1),
  });

  assert.equal(await connector.verifyTenantAccess(), "unknown");
  assert.equal(removed, 0);
  assert.equal(queries.length, 1);
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
