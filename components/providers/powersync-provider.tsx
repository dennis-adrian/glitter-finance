"use client";

// PowerSyncProvider mounts the per-device PowerSyncDatabase, connects it to
// the PowerSync Cloud instance using the current Supabase session, and
// exposes it to descendants two ways:
//
// - via @powersync/react's PowerSyncContext (only present once the db is
//   ready) for components that want to use library hooks like useQuery.
// - via our local OptionalPowerSyncContext (always present; value is null
//   until the db is ready) so app code can subscribe without throwing during
//   the brief async-init window.
//
// The web SDK is browser-only (uses WASM + OPFS + workers); imports are
// lazy-loaded inside useEffect so SSR never touches them.

import { createContext, useContext, useEffect, useState } from "react";
import { PowerSyncContext } from "@powersync/react";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

const OptionalPowerSyncContext =
  createContext<AbstractPowerSyncDatabase | null>(null);

/**
 * Returns the PowerSync database if it has finished initializing, otherwise
 * null. Use this in app code so the calling component renders happily before
 * PowerSync is ready and starts subscribing as soon as it is.
 */
export function useOptionalPowerSyncDb(): AbstractPowerSyncDatabase | null {
  return useContext(OptionalPowerSyncContext);
}

export function PowerSyncProvider({ children }: { children: React.ReactNode }) {
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

      // Status logging — temporary until PR 3 surfaces a visible indicator.
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

  // Always render children inside the OptionalPowerSyncContext so
  // useOptionalPowerSyncDb() resolves to null (not "outside provider")
  // before init completes. PowerSyncContext is only mounted once db exists,
  // so @powersync/react hooks like useQuery/useStatus don't see undefined.
  return (
    <OptionalPowerSyncContext.Provider value={db}>
      {db ? (
        <PowerSyncContext.Provider value={db}>
          {children}
        </PowerSyncContext.Provider>
      ) : (
        children
      )}
    </OptionalPowerSyncContext.Provider>
  );
}
