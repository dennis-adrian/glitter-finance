"use client";

// PowerSyncProvider mounts the per-device PowerSyncDatabase, connects it to
// the PowerSync Cloud instance using the current Supabase session, and
// exposes it through OptionalPowerSyncContext: always present, null until the
// db is ready, so app code can subscribe without throwing during the brief
// async-init window.
//
// The tree has one shape per phase: the local data panel while the data is
// being prepared, cleared or recovered, and `children` otherwise. Nothing wraps
// `children` conditionally, so exposing or withdrawing the db never remounts
// the app in the middle of an action.
//
// The web SDK is browser-only (uses WASM + OPFS + workers); imports are
// lazy-loaded inside useEffect so SSR never touches them.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
} from "@powersync/web";
import {
  LocalDataPanel,
  LocalDataPanelButton,
} from "@/components/providers/local-data-panel";
import {
  LocalDataRecoveryPanel,
  type LocalDataRecovery,
} from "@/components/providers/local-data-recovery-panel";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { isPowerSyncConfigured } from "@/lib/env";
import { markInitialSyncCompleted } from "@/lib/powersync/initial-sync";
import { reconcileSyncFailures } from "@/lib/powersync/sync-failures";
import { flushPendingSyncFailureTelemetry } from "@/lib/observability/report-sync-failure";
import {
  planIdentityMismatch,
  waitForUploadQueueToDrain,
} from "@/lib/powersync/identity-mismatch";
import {
  LocalDataTeardownError,
  localDataIdentityMatches,
  readLocalDataIdentity,
  readUnsyncedLocalWork,
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
   * Disconnects from sync and wipes the local SQLite store + upload queue so
   * the next user on this device doesn't read stale rows that belong to the
   * previous tenant. Refuses with a LocalDataTeardownError, before destroying
   * anything, while uploads are pending or sync failures are unresolved. Once
   * it resolves, the provider shows its progress panel instead of the app
   * until the caller navigates away.
   */
  teardownForLogout: () => Promise<void>;
  /** The same wipe, before changing the active tenant. */
  teardownForTenantChange: () => Promise<void>;
  /**
   * Shows why the server-side step failed after a successful teardown. The
   * app is unmounted by then, so the provider panel is the only place left.
   */
  reportIdentityChangeFailure: (message: string) => void;
};

type IdentityChange = {
  kind: "logout" | "tenant-change";
  error: string | null;
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
  const [identityChange, setIdentityChange] = useState<IdentityChange | null>(
    null
  );
  const [recovery, setRecovery] = useState<LocalDataRecovery | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const connectorRef = useRef<PowerSyncBackendConnector | null>(null);
  const exposedDbRef = useRef<AbstractPowerSyncDatabase | null>(null);
  const teardownPromiseRef = useRef<Promise<void> | null>(null);
  const localDataWasJustClearedRef = useRef(false);

  useEffect(() => {
    const currentIdentity: LocalDataIdentity = {
      userId: identity.userId,
      tenantId: identity.tenantId,
      email: identity.email ?? null,
    };
    let cancelled = false;
    let instance: AbstractPowerSyncDatabase | null = null;

    async function init() {
      setLocalDataReadyIdentity(null);
      setLocalDataError(null);
      setIdentityChange(null);
      setRecovery(null);
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
            refuseWhenUnsynced: false,
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

      const db = instance;
      const supabase = createSupabaseClient();
      const connector = new SupabaseConnector(supabase);

      // A device database belongs to exactly one authenticated user + active
      // tenant. An absent identity is deliberately treated as untrusted (for
      // upgrades from before this marker existed), so stale rows never render:
      // the app stays hidden until the database is cleared. Unsynced work is
      // never cleared with it; it is uploaded first, or kept until the
      // identity that can upload it comes back.
      const storedIdentity = readLocalDataIdentity();
      if (!localDataIdentityMatches(storedIdentity, currentIdentity)) {
        const planMismatch = async () =>
          planIdentityMismatch({
            stored: storedIdentity,
            current: currentIdentity,
            unsynced: await readUnsyncedLocalWork(db),
          });
        let plan = await planMismatch();
        if (cancelled) return;

        if (plan.action === "drain") {
          setRecovery({ kind: "draining", pendingUploadCount: null });
          connectorRef.current = connector;
          await db.connect(connector);
          const outcome = await waitForUploadQueueToDrain(db, {
            isCancelled: () => cancelled,
            onPending: (pendingUploadCount) => {
              if (!cancelled) {
                setRecovery({ kind: "draining", pendingUploadCount });
              }
            },
          });
          if (outcome === "cancelled") return;
          await db.disconnect();
          plan = await planMismatch();
          if (cancelled) return;
          if (plan.action === "drain") {
            throw new Error("The upload queue did not drain.");
          }
        }

        if (plan.action === "block") {
          setRecovery({ kind: "blocked", block: plan.block });
          return;
        }

        setRecovery(null);
        // disconnectAndClear can remove browser-backed transport state. Give
        // the permanent-upload report a bounded chance to leave the device
        // first; failure must not prevent privacy cleanup or cancellation.
        await flushPendingSyncFailureTelemetry();
        // Re-checks the queue right before the wipe.
        await teardownLocalUserData({
          db,
          powerSyncRequired: true,
          refuseWhenUnsynced: true,
        });
      }

      if (cancelled) {
        await instance.close();
        return;
      }
      saveLocalDataIdentity(currentIdentity);

      connectorRef.current = connector;
      await instance.connect(connector);
      try {
        await reconcileSyncFailures(instance);
      } catch (error) {
        console.error(
          "[PowerSync] initial sync failure reconciliation failed",
          {
            error,
          }
        );
      }

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
  }, [
    identity.userId,
    identity.tenantId,
    identity.email,
    initializationAttempt,
  ]);

  const localDataReady = localDataIdentityMatches(
    localDataReadyIdentity,
    identity
  );
  // An identity change makes the old instance unavailable during the render
  // that precedes effect cleanup, rather than after close() has started.
  const exposedDb = localDataReady ? db : null;

  // Controls run from event handlers, after this has pointed them at the
  // committed instance.
  useLayoutEffect(() => {
    exposedDbRef.current = exposedDb;
  }, [exposedDb]);

  // One object for the provider's lifetime, so the context value never
  // changes identity. Its members only read refs and call state setters.
  const [controls] = useState<PowerSyncControls>(() => {
    function finishTeardown(
      kind: IdentityChange["kind"],
      error: string | null
    ) {
      connectorRef.current = null;
      localDataWasJustClearedRef.current = true;
      setIdentityChange({ kind, error });
      setLocalDataReadyIdentity(null);
    }

    async function teardown(kind: IdentityChange["kind"]) {
      if (teardownPromiseRef.current) {
        return teardownPromiseRef.current;
      }

      const activeDb = exposedDbRef.current;
      // A second request between a successful wipe and the navigation that
      // follows it is already safe: the prior local data is gone.
      if (!activeDb && localDataWasJustClearedRef.current) {
        return;
      }

      const teardownPromise = (async () => {
        try {
          await teardownLocalUserData({
            db: activeDb,
            powerSyncRequired: isPowerSyncConfigured(),
            refuseWhenUnsynced: true,
            // Stop exposing the instance before disconnectAndClear can close
            // it. Refusals happen earlier, so they never touch the app.
            onDestructiveStart: () => setDb(null),
          });
        } catch (error) {
          if (
            error instanceof LocalDataTeardownError &&
            error.stage === "post-destructive"
          ) {
            // The database is already gone, so the app cannot resume on it.
            finishTeardown(kind, error.message);
          } else {
            // The destructive steps did not complete; callers keep using the
            // current instance and show their retry message.
            setDb((currentDb) => currentDb ?? activeDb);
          }
          throw error;
        }

        // Stay on the progress panel: the caller commits the account change
        // and reloads, so reconnecting the old identity here would only
        // re-download the data that was just cleared.
        finishTeardown(kind, null);
      })();
      teardownPromiseRef.current = teardownPromise;

      try {
        await teardownPromise;
      } finally {
        teardownPromiseRef.current = null;
      }
    }

    return {
      reconnect: async () => {
        const activeDb = exposedDbRef.current;
        const connector = connectorRef.current;
        if (!activeDb || !connector) return;
        await activeDb.disconnect();
        await activeDb.connect(connector);
        await reconcileSyncFailures(activeDb);
      },
      teardownForLogout: () => teardown("logout"),
      teardownForTenantChange: () => teardown("tenant-change"),
      reportIdentityChangeFailure: (message) =>
        setIdentityChange((current) =>
          current ? { ...current, error: message } : current
        ),
    };
  });

  function renderLocalDataPanel() {
    if (localDataError) {
      return (
        <LocalDataPanel
          layout={loadingLayout}
          tone="alert"
          message={localDataError}
        >
          <LocalDataPanelButton
            onClick={() => setInitializationAttempt((attempt) => attempt + 1)}
          >
            Reintentar limpieza segura
          </LocalDataPanelButton>
        </LocalDataPanel>
      );
    }

    if (identityChange?.error) {
      return (
        <LocalDataPanel
          layout={loadingLayout}
          tone="alert"
          message={identityChange.error}
          detail="Los datos locales ya se borraron. Recarga la página, o vuelve para prepararlos de nuevo con la sesión actual."
        >
          <LocalDataPanelButton onClick={() => window.location.reload()}>
            Recargar la página
          </LocalDataPanelButton>
          <LocalDataPanelButton
            variant="secondary"
            onClick={() => setInitializationAttempt((attempt) => attempt + 1)}
          >
            Volver
          </LocalDataPanelButton>
        </LocalDataPanel>
      );
    }

    if (recovery) {
      return (
        <LocalDataRecoveryPanel layout={loadingLayout} recovery={recovery} />
      );
    }

    return (
      <LocalDataPanel
        layout={loadingLayout}
        tone="status"
        message={
          identityChange?.kind === "logout"
            ? "Cerrando sesión…"
            : "Preparando los datos locales…"
        }
      />
    );
  }

  return (
    <PowerSyncControlsContext.Provider value={controls}>
      <OptionalPowerSyncContext.Provider value={exposedDb}>
        {localDataReady ? children : renderLocalDataPanel()}
      </OptionalPowerSyncContext.Provider>
    </PowerSyncControlsContext.Provider>
  );
}
