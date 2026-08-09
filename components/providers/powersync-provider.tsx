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
import { flushPendingSyncFailureTelemetry } from "@/lib/observability/report-sync-failure";
import {
  LocalDataTeardownError,
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
  /** Use the parent card for preparation/recovery UI instead of a page shell. */
  loadingLayout?: "page" | "parent";
};

export function PowerSyncProvider({
  children,
  identity,
  loadingLayout = "page",
}: PowerSyncProviderProps) {
  const [db, setDb] = useState<AbstractPowerSyncDatabase | null>(null);
  const [localDataReadyIdentity, setLocalDataReadyIdentity] =
    useState<LocalDataIdentity | null>(null);
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const connectorRef = useRef<PowerSyncBackendConnector | null>(null);
  const teardownPromiseRef = useRef<Promise<void> | null>(null);
  const localDataWasJustClearedRef = useRef(false);

  useEffect(() => {
    const currentIdentity: LocalDataIdentity = {
      userId: identity.userId,
      tenantId: identity.tenantId,
    };
    let cancelled = false;
    let instance: AbstractPowerSyncDatabase | null = null;

    async function init() {
      setLocalDataReadyIdentity(null);
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
        localDataWasJustClearedRef.current = false;
        setLocalDataReadyIdentity(currentIdentity);
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
          // Turbopack cannot reliably bundle PowerSync's dynamic worker
          // imports. The development/build scripts copy these prebuilt
          // workers to public so deployed builds can load stable URLs.
          worker: "/@powersync/worker/WASQLiteDB.umd.js",
        }),
        schema: AppSchema,
        sync: {
          worker: "/@powersync/worker/SharedSyncImplementation.umd.js",
        },
      });

      // A device database belongs to exactly one authenticated user + active
      // tenant. An absent identity is deliberately treated as untrusted (for
      // upgrades from before this marker existed), so stale rows never render.
      if (!localDataIdentityMatches(readLocalDataIdentity(), currentIdentity)) {
        // disconnectAndClear can remove browser-backed transport state. Give
        // the permanent-upload report a bounded chance to leave the device
        // first; failure must not prevent privacy cleanup or cancellation.
        await flushPendingSyncFailureTelemetry();
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
      localDataWasJustClearedRef.current = false;
      setLocalDataReadyIdentity(currentIdentity);
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
      // The next identity render gates this instance immediately; clearing it
      // here also prevents a closing instance from remaining in this context.
      setDb((currentDb) => (currentDb === instance ? null : currentDb));
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
  async function teardown(
    refuseWhenSyncFailuresExist: boolean,
    reinitialize: boolean
  ) {
    if (teardownPromiseRef.current) {
      return teardownPromiseRef.current;
    }

    // A second request between a successful wipe and the replacement
    // initialization is already safe: the prior local data is gone.
    if (!db && localDataWasJustClearedRef.current) {
      return;
    }

    const activeDb = db;
    const teardownPromise = (async () => {
      // Stop exposing the instance before disconnectAndClear can close it.
      setDb(null);
      try {
        await teardownLocalUserData({
          db: activeDb,
          powerSyncRequired: isPowerSyncConfigured(),
          refuseWhenSyncFailuresExist,
        });
      } catch (error) {
        if (
          error instanceof LocalDataTeardownError &&
          error.stage === "post-destructive"
        ) {
          connectorRef.current = null;
          localDataWasJustClearedRef.current = true;
          setLocalDataReadyIdentity(null);
          setInitializationAttempt((attempt) => attempt + 1);
        } else {
          // Recoverable checks occur before destructive work, so callers can
          // keep using the current instance and show their retry message.
          setDb(activeDb);
        }
        throw error;
      }

      connectorRef.current = null;
      localDataWasJustClearedRef.current = true;
      setLocalDataReadyIdentity(null);
      if (reinitialize) {
        setInitializationAttempt((attempt) => attempt + 1);
      }
    })();
    teardownPromiseRef.current = teardownPromise;

    try {
      await teardownPromise;
    } finally {
      teardownPromiseRef.current = null;
    }
  }
  const teardownForIdentityChange = (reinitialize: boolean) =>
    teardown(true, reinitialize);
  // Keep both domain names: callers use them to make the authenticated action
  // explicit. Logout must stay disconnected until server sign-out, while a
  // tenant change rebuilds the provider if its server-side action fails.
  controlsRef.current.teardownForLogout = () =>
    teardownForIdentityChange(false);
  controlsRef.current.teardownForTenantChange = () =>
    teardownForIdentityChange(true);

  const localDataReady = localDataIdentityMatches(
    localDataReadyIdentity,
    identity
  );
  // An identity change makes the old instance unavailable during the render
  // that precedes effect cleanup, rather than after close() has started.
  const exposedDb = localDataReady ? db : null;

  // Always render children inside the OptionalPowerSyncContext so
  // useOptionalPowerSyncDb() resolves to null (not "outside provider")
  // before init completes. PowerSyncContext is only mounted once db exists,
  // so @powersync/react hooks like useQuery/useStatus don't see undefined.
  return (
    <PowerSyncControlsContext.Provider value={controlsRef.current}>
      <OptionalPowerSyncContext.Provider value={exposedDb}>
        {!localDataReady ? (
          <div
            className={
              loadingLayout === "parent"
                ? "grid w-full place-items-center py-4"
                : "grid min-h-dvh place-items-center p-6"
            }
            role={localDataError ? "alert" : "status"}
            aria-live={localDataError ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <section
              className={
                loadingLayout === "parent"
                  ? "w-full text-center"
                  : "w-full max-w-sm rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10"
              }
            >
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
        ) : exposedDb ? (
          <PowerSyncContext.Provider value={exposedDb}>
            {children}
          </PowerSyncContext.Provider>
        ) : (
          children
        )}
      </OptionalPowerSyncContext.Provider>
    </PowerSyncControlsContext.Provider>
  );
}
