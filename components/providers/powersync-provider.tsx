"use client";

// PowerSyncProvider mounts the per-device PowerSyncDatabase, connects it to
// the PowerSync Cloud instance using the current Supabase session, and
// exposes it to descendants via PowerSyncContext (from @powersync/react).
//
// The web SDK is browser-only (uses WASM + OPFS + workers); imports are
// lazy-loaded inside useEffect so SSR never touches them.
//
// PR 2a scope: provider is mounted and connects, but no UI component yet
// reads from it. Verification is via the browser console (see the status
// logging below). PR 2b will switch the products read path to live SQLite
// queries via usePowerSync().

import { useEffect, useState } from "react";
import { PowerSyncContext } from "@powersync/react";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

export function PowerSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [db, setDb] = useState<AbstractPowerSyncDatabase | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: AbstractPowerSyncDatabase | null = null;

    async function init() {
      const [
        { PowerSyncDatabase, WASQLiteOpenFactory, WASQLiteVFS },
        { AppSchema },
        { SupabaseConnector },
      ] = await Promise.all([
        import("@powersync/web"),
        import("@/lib/powersync/schema"),
        import("@/lib/powersync/connector"),
      ]);

      if (cancelled) return;

      // OPFSCoopSyncVFS is mandatory on iOS Safari per PRD §9. We use it on
      // every platform for one consistent storage model.
      instance = new PowerSyncDatabase({
        database: new WASQLiteOpenFactory({
          dbFilename: "glitter-pos.db",
          vfs: WASQLiteVFS.OPFSCoopSyncVFS,
        }),
        schema: AppSchema,
      });

      const supabase = createSupabaseClient();
      await instance.connect(new SupabaseConnector(supabase));

      // Verification logging for PR 2a (no UI surface yet). Removed/replaced
      // by a visible sync indicator in a later PR.
      const unsubscribe = instance.registerListener({
        statusChanged: (status) => {
          console.info("[PowerSync] status", {
            connected: status.connected,
            hasSynced: status.hasSynced,
            lastSyncedAt: status.lastSyncedAt?.toISOString(),
          });
        },
      });

      if (cancelled) {
        unsubscribe();
        await instance.close();
        return;
      }

      setDb(instance);
    }

    init().catch((error) => {
      console.error("[PowerSync] init failed", error);
    });

    return () => {
      cancelled = true;
      instance?.close().catch(() => {});
    };
  }, []);

  // Render children whether or not PowerSync is ready. Until db is set,
  // PowerSyncContext is absent — consumers that call usePowerSync() will
  // throw. That's fine for PR 2a since nothing consumes it yet.
  if (!db) {
    return <>{children}</>;
  }

  return (
    <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>
  );
}
