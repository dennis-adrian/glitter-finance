// Noticing on a device that its user is no longer a member of the tenant its
// local data belongs to: the owner removed them, they left on another
// device, or they deleted their account there.
//
// The sync streams require a tenant_users membership (powersync/sync-rules.yaml),
// so the next checkpoint after the membership is deleted drops the whole
// tenant from the device, including the user's own tenant_users row, while
// the upload queue keeps what was not uploaded yet. A synced database without
// that row is the sign. It is only a sign: the server is asked
// (SupabaseConnector.verifyTenantAccess) before the device says anything,
// since a database synced before tenant_users was replicated lacks it too.
//
// The connector reaches the same answer on its own when a refreshed token no
// longer claims the tenant, which is what a device that was offline sees
// first (the removal moves the claim away, app/tenants/actions.ts).

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { watchLocalTables } from "@/lib/powersync/local-watch";

/** What the server says about the user's membership in the device's tenant. */
export type TenantAccess = "member" | "removed" | "unknown";

/** How often a missing membership row may be checked with the server. */
export const TENANT_ACCESS_CHECK_INTERVAL_MS = 30_000;

/** The check the watch feeds, and its cleanup. */
export type TenantAccessCheck = ((count: number) => Promise<void>) & {
  dispose: () => void;
};

/**
 * Returns the function the watch calls with the number of membership rows
 * it reads. It asks the server when there is none, at most once per
 * `minIntervalMs` and never twice at once, and calls `onRemoved` once the
 * server confirms the membership is gone. When the server could not answer
 * (offline, an error), or a change came too soon after the last answer to
 * ask again, it asks once the interval has passed for as long as the row
 * stays missing: the watch only fires when the table changes, and a dropped
 * tenant stays empty. So does a "member" answer when the rows changed while
 * it was being asked and the row is still missing: the server may have read
 * the membership just before it was deleted.
 */
export function createTenantAccessCheck(input: {
  verify: () => Promise<TenantAccess>;
  onRemoved: () => void;
  minIntervalMs?: number;
  /** A monotonic clock, in milliseconds. */
  now?: () => number;
  /** Runs `run` after `ms`; returns the cancel. */
  schedule?: (run: () => void, ms: number) => () => void;
}): TenantAccessCheck {
  const minIntervalMs = input.minIntervalMs ?? TENANT_ACCESS_CHECK_INTERVAL_MS;
  const now = input.now ?? (() => performance.now());
  const schedule =
    input.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  let lastCheckAt: number | null = null;
  let lastCount: number | null = null;
  let checking = false;
  // A change arrived while the server was being asked, so its answer may be
  // older than what the device now holds.
  let changedWhileChecking = false;
  let removed = false;
  let disposed = false;
  let cancelRetry: (() => void) | null = null;

  function retryAfter(ms: number) {
    if (cancelRetry) return;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      if (lastCount === 0) void onMembershipRows(0);
    }, ms);
  }

  async function onMembershipRows(count: number): Promise<void> {
    lastCount = count;
    if (count > 0) {
      cancelRetry?.();
      cancelRetry = null;
    }
    if (checking) changedWhileChecking = true;
    if (count > 0 || removed || checking || disposed) return;
    const time = now();
    if (lastCheckAt !== null && time - lastCheckAt < minIntervalMs) {
      // Too soon after the last answer, which this change may have outdated:
      // the watch will not fire again for a tenant that stays empty.
      retryAfter(minIntervalMs - (time - lastCheckAt));
      return;
    }
    lastCheckAt = time;
    checking = true;
    changedWhileChecking = false;
    let answer: TenantAccess = "unknown";
    try {
      answer = await input.verify();
    } catch (error) {
      console.warn("[PowerSync] tenant access check failed", { error });
    } finally {
      checking = false;
    }
    if (disposed) return;
    if (answer === "removed") {
      removed = true;
      input.onRemoved();
    } else if (
      answer === "unknown" ||
      (changedWhileChecking && lastCount === 0)
    ) {
      retryAfter(minIntervalMs);
    }
  }

  return Object.assign(onMembershipRows, {
    dispose: () => {
      disposed = true;
      cancelRetry?.();
      cancelRetry = null;
    },
  });
}

/**
 * Watches the user's own membership row once the first sync has completed.
 * Returns the cleanup.
 */
export function watchTenantAccess(
  db: AbstractPowerSyncDatabase,
  input: {
    tenantId: string;
    userId: string;
    verify: () => Promise<TenantAccess>;
    onRemoved: () => void;
  }
): () => void {
  const check = createTenantAccessCheck(input);
  const stopWatching = watchLocalTables(db, ({ signal, synced }) => {
    if (!synced) return;
    db.watch(
      `SELECT count(*) AS count FROM tenant_users WHERE tenant_id = ? AND user_id = ?`,
      [input.tenantId, input.userId],
      {
        onResult: (results) => {
          if (signal.aborted) return;
          const row = results.rows?._array?.[0] as
            | { count?: number }
            | undefined;
          void check(Number(row?.count ?? 0));
        },
        onError: (error) => {
          console.warn("[PowerSync] tenant access watch failed", { error });
        },
      },
      { signal }
    );
  });
  return () => {
    stopWatching();
    check.dispose();
  };
}
