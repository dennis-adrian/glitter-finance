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

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { PowerSyncContext } from "@powersync/react";
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
} from "@powersync/web";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { isPowerSyncConfigured } from "@/lib/env";
import { markInitialSyncCompleted } from "@/lib/powersync/initial-sync";
import {
  localDataIdentityMatches,
  readLocalDataIdentity,
  saveLocalDataIdentity,
  teardownLocalUserData,
  type LocalDataIdentity,
} from "@/lib/powersync/local-data-teardown";

const OptionalPowerSyncContext =
  createContext<AbstractPowerSyncDatabase | null>(null);

type PowerSyncControls = {
  /**
   * Disconnects and re-connects the PowerSync client, which refreshes the
   * Supabase JWT and kicks the upload queue. Surfaced via the Diagnostics
   * screen's "Forzar sincronización" button.
   */
  reconnect: () => Promise<void>;
  /**
   * Disconnects from sync and wipes the local SQLite store + upload queue.
   * Called during sign out so the next user on this device doesn't read
   * stale rows that belong to the previous tenant.
   */
  teardownForLogout: () => Promise<void>;
  /** Clear every prior-tenant artifact before changing the active tenant. */
  teardownForTenantChange: () => Promise<void>;
};

const PowerSyncControlsContext = createContext<PowerSyncControls | null>(null);

/**
 * Returns the PowerSync database if it has finished initializing, otherwise
 * null. Use this in app code so the calling component renders happily before
 * PowerSync is ready and starts subscribing as soon as it is.
 */
export function useOptionalPowerSyncDb(): AbstractPowerSyncDatabase | null {
  return useContext(OptionalPowerSyncContext);
}

export function usePowerSyncControls(): PowerSyncControls | null {
  return useContext(PowerSyncControlsContext);
}

type PowerSyncProviderProps = {
  children: React.ReactNode;
  identity: LocalDataIdentity;
};

export function PowerSyncProvider({
  children,
  identity,
}: PowerSyncProviderProps) {
  const [db, setDb] = useState<AbstractPowerSyncDatabase | null>(null);
  const [localDataReady, setLocalDataReady] = useState(false);
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const connectorRef = useRef<PowerSyncBackendConnector | null>(null);

  useEffect(() => {
    const currentIdentity: LocalDataIdentity = {
      userId: identity.userId,
      tenantId: identity.tenantId,
    };
    let cancelled = false;
    let instance: AbstractPowerSyncDatabase | null = null;

    async function init() {
      setLocalDataReady(false);
      setLocalDataError(null);
      setDb(null);

      const powerSyncConfigured = isPowerSyncConfigured();
      if (!powerSyncConfigured) {
        if (process.env.NODE_ENV !== "production") {
          console.info(
            "[PowerSync] disabled — set NEXT_PUBLIC_POWERSYNC_URL to enable sync"
          );
        }

        if (
          !localDataIdentityMatches(readLocalDataIdentity(), currentIdentity)
        ) {
          await teardownLocalUserData({
            db: null,
            powerSyncRequired: false,
            refuseWhenSyncFailuresExist: false,
          });
        }
        if (cancelled) return;
        saveLocalDataIdentity(currentIdentity);
        setLocalDataReady(true);
        return;
      }

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

      // A device database belongs to exactly one authenticated user + active
      // tenant. An absent identity is deliberately treated as untrusted (for
      // upgrades from before this marker existed), so stale rows never render.
      if (!localDataIdentityMatches(readLocalDataIdentity(), currentIdentity)) {
        await teardownLocalUserData({
          db: instance,
          powerSyncRequired: true,
          refuseWhenSyncFailuresExist: false,
        });
      }

      if (cancelled) {
        await instance.close();
        return;
      }
      saveLocalDataIdentity(currentIdentity);

      const supabase = createSupabaseClient();
      const connector = new SupabaseConnector(supabase);
      connectorRef.current = connector;
      await instance.connect(connector);

      // Status logging — kept alongside the visible pill so tester bug
      // reports show a console trail too.
      const unsubscribe = instance.registerListener({
        statusChanged: (status) => {
          if (status.hasSynced) {
            markInitialSyncCompleted();
          }

          if (process.env.NODE_ENV !== "production") {
            console.info("[PowerSync] status", {
              connected: status.connected,
              hasSynced: status.hasSynced,
              uploading: status.dataFlowStatus.uploading,
              downloading: status.dataFlowStatus.downloading,
              uploadError: status.dataFlowStatus.uploadError
                ? String(
                    status.dataFlowStatus.uploadError.message ??
                      status.dataFlowStatus.uploadError
                  )
                : null,
              downloadError: status.dataFlowStatus.downloadError
                ? String(
                    status.dataFlowStatus.downloadError.message ??
                      status.dataFlowStatus.downloadError
                  )
                : null,
              lastSyncedAt: status.lastSyncedAt?.toISOString(),
            });
          }
        },
      });

      if (cancelled) {
        unsubscribe();
        await instance.close();
        return;
      }

      setDb(instance);
      setLocalDataReady(true);
    }

    init().catch((error) => {
      console.error("[PowerSync] init failed", error);
      if (!cancelled) {
        setDb(null);
        setLocalDataError(
          "No se pudieron preparar los datos locales de forma segura."
        );
      }
    });

    return () => {
      cancelled = true;
      instance?.close().catch(() => {});
    };
  }, [identity.userId, identity.tenantId, initializationAttempt]);

  // Reconnect/teardown closures are kept on a stable ref so the controls
  // context value doesn't change identity and trigger spurious consumer
  // re-renders.
  const controlsRef = useRef<PowerSyncControls>({
    reconnect: async () => {
      if (!db || !connectorRef.current) return;
      await db.disconnect();
      await db.connect(connectorRef.current);
    },
    teardownForLogout: async () => {},
    teardownForTenantChange: async () => {},
  });
  // Refresh the closures when `db` updates so they capture the live instance.
  controlsRef.current.reconnect = async () => {
    if (!db || !connectorRef.current) return;
    await db.disconnect();
    await db.connect(connectorRef.current);
  };
  async function teardown(refuseWhenSyncFailuresExist: boolean) {
    await teardownLocalUserData({
      db,
      powerSyncRequired: isPowerSyncConfigured(),
      refuseWhenSyncFailuresExist,
    });
    connectorRef.current = null;
    setDb(null);
  }
  controlsRef.current.teardownForLogout = async () => {
    await teardown(true);
  };
  controlsRef.current.teardownForTenantChange = async () => {
    await teardown(true);
  };

  // Always render children inside the OptionalPowerSyncContext so
  // useOptionalPowerSyncDb() resolves to null (not "outside provider")
  // before init completes. PowerSyncContext is only mounted once db exists,
  // so @powersync/react hooks like useQuery/useStatus don't see undefined.
  return (
    <PowerSyncControlsContext.Provider value={controlsRef.current}>
      <OptionalPowerSyncContext.Provider value={db}>
        {!localDataReady ? (
          <div
            className="grid min-h-dvh place-items-center p-6"
            role="status"
            aria-live="polite"
          >
            <section className="w-full max-w-sm rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
              <p className="text-sm text-muted-foreground">
                {localDataError ?? "Preparando los datos locales…"}
              </p>
              {localDataError ? (
                <button
                  type="button"
                  className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  onClick={() =>
                    setInitializationAttempt((attempt) => attempt + 1)
                  }
                >
                  Reintentar limpieza segura
                </button>
              ) : null}
            </section>
          </div>
        ) : db ? (
          <PowerSyncContext.Provider value={db}>
            {children}
          </PowerSyncContext.Provider>
        ) : (
          children
        )}
      </OptionalPowerSyncContext.Provider>
    </PowerSyncControlsContext.Provider>
  );
}
