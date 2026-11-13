"use client";

// PowerSyncProvider mounts the per-device PowerSyncDatabase, connects it to
// the PowerSync Cloud instance using the current Supabase session, and
// exposes it through OptionalPowerSyncContext: always present, null until the
// db is ready, so app code can subscribe without throwing during the brief
// async-init window. It also provides the one sync status store that every
// useSyncStatus caller shares.
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
  useMemo,
  useRef,
  useState,
} from "react";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import {
  LocalDataPanel,
  LocalDataPanelButton,
} from "@/components/providers/local-data-panel";
import {
  LocalDataRecoveryPanel,
  type LocalDataRecoveryControls,
} from "@/components/providers/local-data-recovery-panel";
import { loadDocument } from "@/lib/auth/identity-change";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { isPowerSyncConfigured } from "@/lib/env";
import type { SupabaseConnector } from "@/lib/powersync/connector";
import { withUploadsPaused } from "@/lib/powersync/pause-uploads";
import { reconcileSyncFailures } from "@/lib/powersync/sync-failures";
import {
  createSyncStatusStore,
  idleSyncStatusStore,
  syncErrorText,
} from "@/lib/powersync/sync-status";
import {
  SessionEndedPanel,
  type SessionEndedControls,
} from "@/components/providers/session-ended-panel";
import { watchTenantAccess } from "@/lib/powersync/tenant-access";
import {
  isSessionEndEvent,
  type SessionEndedWork,
} from "@/lib/auth/session-end";
import { SyncStatusStoreProvider } from "@/lib/powersync/use-sync-status";
import { reportClientFailure } from "@/lib/observability/report-client-failure";
import {
  flushPendingSyncFailureTelemetry,
  reportDiscardedUnsyncedWork,
} from "@/lib/observability/report-sync-failure";
import {
  canDiscardUnsyncedWork,
  canUploadUnsyncedWork,
  exportUnsyncedLocalWork,
  planIdentityMismatch,
  readUnsyncedWorkOwner,
  waitForUploadQueueToDrain,
} from "@/lib/powersync/identity-mismatch";
import {
  localDataRecoveryFor,
  type LocalDataRecovery,
} from "@/lib/powersync/local-data-recovery";
import {
  LocalDataTeardownError,
  localDataIdentityMatches,
  readLocalDataIdentity,
  readUnsyncedLocalWork,
  saveLocalDataIdentity,
  teardownLocalUserData,
  type LocalDataIdentity,
  type UnsyncedLocalWork,
} from "@/lib/powersync/local-data-teardown";

const OptionalPowerSyncContext =
  createContext<AbstractPowerSyncDatabase | null>(null);

type PowerSyncControls = {
  /**
   * Disconnects and re-connects the PowerSync client, which refreshes the
   * Supabase JWT, checks its tenant claim again and kicks the upload queue.
   * Surfaced via the Diagnostics screen's "Forzar sincronización" button.
   */
  reconnect: () => Promise<void>;
  /**
   * Runs `task` on the database while it uploads nothing, then connects it
   * again. An upload already in flight finishes first. Diagnostics discards
   * a failed transaction this way (lib/powersync/pause-uploads.ts).
   */
  withUploadsPaused: <T>(
    task: (db: AbstractPowerSyncDatabase) => Promise<T>
  ) => Promise<T>;
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
  // The server confirmed the user is no longer a member of the local data's
  // tenant (lib/powersync/tenant-access.ts). Only a reload moves on.
  const [accessRemoved, setAccessRemoved] = useState(false);
  // The session ended on its own while the app was shown
  // (lib/auth/session-end.ts), with the work the device still holds.
  const [sessionEnded, setSessionEnded] = useState<{
    work: SessionEndedWork;
  } | null>(null);
  const identityRef = useRef(identity);
  // "Seguir registrando" was chosen; cleared when the user comes back.
  const sessionEndDismissedRef = useRef(false);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const connectorRef = useRef<SupabaseConnector | null>(null);
  const exposedDbRef = useRef<AbstractPowerSyncDatabase | null>(null);
  const teardownPromiseRef = useRef<Promise<void> | null>(null);
  const localDataWasJustClearedRef = useRef(false);
  // The recovery panel's actions on the database the current initialization
  // holds, and the identity whose unsynced work the user chose to discard.
  const recoveryControlsRef = useRef<LocalDataRecoveryControls | null>(null);
  const confirmedDiscardRef = useRef<LocalDataIdentity | null>(null);

  useEffect(() => {
    const currentIdentity: LocalDataIdentity = {
      userId: identity.userId,
      tenantId: identity.tenantId,
      email: identity.email ?? null,
    };
    let cancelled = false;
    let instance: AbstractPowerSyncDatabase | null = null;
    let recoveryControls: LocalDataRecoveryControls | null = null;
    let stopAccessWatch: (() => void) | null = null;
    let stopSessionWatch: (() => void) | null = null;

    async function init() {
      setLocalDataReadyIdentity(null);
      setLocalDataError(null);
      setIdentityChange(null);
      setRecovery(null);
      setAccessRemoved(false);
      setSessionEnded(null);
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
      // A session that ended on its own (lib/auth/session-end.ts) gives way
      // to the session-ended panel, never during this page's own sign-out,
      // account deletion or tenant change, which tear down first. Events and
      // later checks only count while the app shows this database:
      // preparation and recovery have panels of their own, and the check
      // right before the app shows covers them.
      const endSession = async (whileShown: boolean) => {
        const ownTeardown = () =>
          Boolean(teardownPromiseRef.current) ||
          localDataWasJustClearedRef.current;
        if (cancelled || ownTeardown()) return;
        if (whileShown && exposedDbRef.current !== db) return;
        const work = await readUnsyncedLocalWork(db).then(
          (unsynced): SessionEndedWork => ({
            pendingUploadCount: unsynced.pendingUploadCount,
            unresolvedFailureCount: unsynced.unresolvedFailureCount,
          }),
          (error) => {
            console.error("[PowerSync] unsynced work read failed", error);
            return null;
          }
        );
        if (!cancelled && !ownTeardown()) setSessionEnded({ work });
      };
      // No session, and no error: a failed refresh that keeps the session
      // (offline, 502 to 504) reports an error instead.
      const sessionIsGone = async () => {
        try {
          const { data, error } = await supabase.auth.getSession();
          return !error && !data.session;
        } catch {
          return false;
        }
      };
      const checkSession = () => {
        void sessionIsGone().then((gone) => {
          if (gone) void endSession(true);
        });
      };
      // The one browser client refreshes the session for the whole page, so
      // its SIGNED_OUT is how a session revoked elsewhere usually shows up.
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
        if (!isSessionEndEvent(event)) return;
        // Not inside the callback, which runs under the auth client's lock.
        window.setTimeout(() => void endSession(true), 0);
      });
      // The server can clear the session cookies with no event here.
      // The user coming back to the app (or the connection coming back)
      // asks again, even after "Seguir registrando".
      const checkWhenVisible = () => {
        if (document.visibilityState !== "visible") return;
        sessionEndDismissedRef.current = false;
        checkSession();
      };
      window.addEventListener("focus", checkWhenVisible);
      window.addEventListener("online", checkWhenVisible);
      document.addEventListener("visibilitychange", checkWhenVisible);
      stopSessionWatch = () => {
        subscription.unsubscribe();
        window.removeEventListener("focus", checkWhenVisible);
        window.removeEventListener("online", checkWhenVisible);
        document.removeEventListener("visibilitychange", checkWhenVisible);
      };
      // Only hands PowerSync a token whose tenant claim is this identity's,
      // so another tenant's rows can never sync into this database.
      const connector = new SupabaseConnector(
        supabase,
        currentIdentity.tenantId,
        {
          // A connect that finds no session at all.
          // PowerSync retries every few seconds; after "Seguir registrando"
          // that must not bring the panel straight back.
          onSessionMissing: () => {
            if (!sessionEndDismissedRef.current) {
              window.setTimeout(checkSession, 0);
            }
          },
          onAccessRemoved: () => {
            // A recovery upload's denial says nothing new: the panel there
            // already offers the ways out.
            if (
              !cancelled &&
              localDataIdentityMatches(readLocalDataIdentity(), currentIdentity)
            ) {
              setAccessRemoved(true);
            }
          },
        }
      );

      // A device database belongs to exactly one authenticated user + active
      // tenant. An absent identity is deliberately treated as untrusted (for
      // upgrades from before this marker existed), so stale rows never render:
      // the app stays hidden until the database is cleared. Unsynced work is
      // never cleared with it unless the user discards it; it is uploaded
      // first, or kept until the identity that can upload it comes back.
      const storedIdentity = readLocalDataIdentity();
      if (!localDataIdentityMatches(storedIdentity, currentIdentity)) {
        // Without a marker, the queue itself names whose work it is.
        const owner = storedIdentity ?? (await readUnsyncedWorkOwner(db));
        let connectedForUploads = false;
        recoveryControls = {
          retryUpload: async () => {
            if (!connectedForUploads || cancelled) return;
            await db.disconnect();
            if (!connectedForUploads || cancelled) return;
            await db.connect(connector);
          },
          exportUnsyncedWork: () =>
            exportUnsyncedLocalWork(db, { owner, session: currentIdentity }),
          discardUnsyncedWork: () => {
            confirmedDiscardRef.current = currentIdentity;
            setInitializationAttempt((attempt) => attempt + 1);
          },
        };
        recoveryControlsRef.current = recoveryControls;
        const discardConfirmed = localDataIdentityMatches(
          confirmedDiscardRef.current,
          currentIdentity
        );
        confirmedDiscardRef.current = null;

        const planMismatch = (unsynced: UnsyncedLocalWork) =>
          planIdentityMismatch({ owner, current: currentIdentity, unsynced });
        let unsynced = await readUnsyncedLocalWork(db);
        let plan = planMismatch(unsynced);
        if (cancelled) return;

        // The user saw this work stuck, downloaded a copy if they wanted
        // one, and confirmed discarding it (LocalDataRecoveryPanel).
        const discarding = discardConfirmed && canDiscardUnsyncedWork(plan);
        if (plan.action !== "clear" && !discarding) {
          const initialProgress = {
            ...unsynced,
            uploadError: null,
            stalled: false,
          };
          setRecovery(localDataRecoveryFor(plan, initialProgress));
          if (!canUploadUnsyncedWork(plan)) {
            // Another account's work: never uploaded with this session.
            return;
          }

          // This user's work, or work nobody can be named for: upload what
          // the server accepts. A blocked upload stays connected, so it goes
          // through once its cause is fixed, and the queue then drains.
          connectorRef.current = connector;
          await db.connect(connector);
          connectedForUploads = true;
          const outcome = await waitForUploadQueueToDrain(db, {
            isCancelled: () => cancelled,
            onProgress: (progress) => {
              if (!cancelled) {
                setRecovery(
                  localDataRecoveryFor(planMismatch(progress), progress)
                );
              }
            },
          });
          if (outcome === "cancelled") return;
          connectedForUploads = false;
          await db.disconnect();
          if (cancelled) return;
          unsynced = await readUnsyncedLocalWork(db);
          plan = planMismatch(unsynced);
          if (cancelled) return;
          if (plan.action !== "clear") {
            throw new Error("The upload queue did not drain.");
          }
        }

        setRecovery(null);
        if (discarding && plan.action === "block") {
          reportDiscardedUnsyncedWork({
            reason: plan.block.reason,
            pendingUploadCount: unsynced.pendingUploadCount,
            unresolvedFailureCount: unsynced.unresolvedFailureCount,
          });
        }
        // disconnectAndClear can remove browser-backed transport state. Give
        // the permanent-upload report a bounded chance to leave the device
        // first; failure must not prevent privacy cleanup or cancellation.
        await flushPendingSyncFailureTelemetry();
        if (cancelled) return;
        // Otherwise re-checks the queue right before the wipe.
        await teardownLocalUserData({
          db,
          powerSyncRequired: true,
          refuseWhenUnsynced: !discarding,
        });
      }

      if (cancelled) {
        await instance.close();
        return;
      }
      saveLocalDataIdentity(currentIdentity);

      connectorRef.current = connector;
      await instance.connect(connector);
      if (currentIdentity.tenantId) {
        stopAccessWatch = watchTenantAccess(instance, {
          tenantId: currentIdentity.tenantId,
          userId: currentIdentity.userId,
          verify: () => connector.verifyTenantAccess(),
          // The connector reports it through onAccessRemoved.
          onRemoved: () => {},
        });
      }
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
          if (process.env.NODE_ENV !== "production") {
            console.info("[PowerSync] status", {
              connected: status.connected,
              hasSynced: status.hasSynced,
              uploading: status.dataFlowStatus.uploading,
              downloading: status.dataFlowStatus.downloading,
              uploadError: syncErrorText(status.dataFlowStatus.uploadError),
              downloadError: syncErrorText(status.dataFlowStatus.downloadError),
              lastSyncedAt: status.lastSyncedAt?.toISOString(),
            });
          }
        },
      });

      // A SIGNED_OUT while preparing or recovering was not acted on.
      const sessionGoneBeforeShowing = await sessionIsGone();
      if (cancelled) {
        unsubscribe();
        await instance.close();
        return;
      }
      if (sessionGoneBeforeShowing) await endSession(false);

      setDb(instance);
      localDataWasJustClearedRef.current = false;
      setLocalDataReadyIdentity(currentIdentity);
    }

    init().catch((error) => {
      // Cleanup closes the database under an initialization it cancelled, so
      // a step still running then fails on the closed database. That is not
      // a start-up failure: nothing failed for the user.
      if (cancelled) return;
      console.error("[PowerSync] init failed", error);
      reportClientFailure("powersync_init", error);
      setDb(null);
      setLocalDataError(
        "No se pudieron preparar los datos locales de forma segura."
      );
    });

    return () => {
      cancelled = true;
      stopAccessWatch?.();
      stopSessionWatch?.();
      if (recoveryControlsRef.current === recoveryControls) {
        recoveryControlsRef.current = null;
      }
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

  // One sync status reader per database, shared by every screen that shows
  // it. It only polls while something is subscribed.
  const syncStatusStore = useMemo(
    () => (exposedDb ? createSyncStatusStore(exposedDb) : idleSyncStatusStore),
    [exposedDb]
  );

  // Controls run from event handlers, after this has pointed them at the
  // committed instance.
  useLayoutEffect(() => {
    exposedDbRef.current = exposedDb;
    identityRef.current = identity;
  }, [exposedDb, identity]);

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
        connector.recheckTenantClaim();
        await activeDb.disconnect();
        await activeDb.connect(connector);
        await reconcileSyncFailures(activeDb);
      },
      withUploadsPaused: async (task) => {
        const activeDb = exposedDbRef.current;
        const connector = connectorRef.current;
        if (!activeDb || !connector) {
          throw new Error("The local database is not open.");
        }
        return withUploadsPaused(
          activeDb,
          async () => {
            // A teardown or a new initialization owns the database now.
            if (
              exposedDbRef.current !== activeDb ||
              connectorRef.current !== connector
            ) {
              return;
            }
            try {
              await activeDb.connect(connector);
            } catch (error) {
              console.error("[PowerSync] reconnect after a pause failed", {
                error,
              });
            }
          },
          () => task(activeDb)
        );
      },
      teardownForLogout: () => teardown("logout"),
      teardownForTenantChange: () => teardown("tenant-change"),
      reportIdentityChangeFailure: (message) =>
        setIdentityChange((current) =>
          current ? { ...current, error: message } : current
        ),
    };
  });

  // Stable, like `controls`. Downloading keeps the work; discarding is the
  // way out when the account it belongs to no longer exists.
  const [sessionEndedControls] = useState<SessionEndedControls>(() => ({
    exportUnsyncedWork: async () => {
      const activeDb = exposedDbRef.current;
      if (!activeDb) {
        throw new Error("The local database is not open.");
      }
      const owner = identityRef.current;
      return exportUnsyncedLocalWork(activeDb, { owner, session: owner });
    },
    discardUnsyncedWork: async () => {
      const activeDb = exposedDbRef.current;
      if (activeDb) {
        const unsynced = await readUnsyncedLocalWork(activeDb).catch(
          () => null
        );
        reportDiscardedUnsyncedWork({
          reason: "session-ended",
          pendingUploadCount: unsynced?.pendingUploadCount ?? 0,
          unresolvedFailureCount: unsynced?.unresolvedFailureCount ?? 0,
        });
        await flushPendingSyncFailureTelemetry();
      }
      localDataWasJustClearedRef.current = true;
      try {
        await teardownLocalUserData({
          db: activeDb,
          powerSyncRequired: isPowerSyncConfigured(),
          refuseWhenUnsynced: false,
          onDestructiveStart: () => setDb(null),
        });
      } catch (error) {
        if (
          error instanceof LocalDataTeardownError &&
          error.stage === "post-destructive"
        ) {
          // The work is already gone; only browser leftovers were not
          // cleared, and the login page's next identity clears them.
          console.error("[session-ended] discard left local leftovers", error);
          return;
        }
        // Nothing was deleted: keep the database, so the copy can still be
        // downloaded and the discard retried.
        localDataWasJustClearedRef.current = false;
        setDb((currentDb) => currentDb ?? activeDb);
        throw error;
      }
    },
    continueWithoutSession: () => {
      sessionEndDismissedRef.current = true;
      setSessionEnded(null);
    },
  }));

  // Stable for the provider's lifetime, like `controls`: it reaches the
  // current initialization's database through the ref when a button runs.
  const [recoveryPanelControls] = useState<LocalDataRecoveryControls>(() => ({
    retryUpload: async () => {
      await recoveryControlsRef.current?.retryUpload();
    },
    exportUnsyncedWork: async () => {
      const current = recoveryControlsRef.current;
      if (!current) {
        throw new Error("The local database is not open for recovery.");
      }
      return current.exportUnsyncedWork();
    },
    discardUnsyncedWork: () =>
      recoveryControlsRef.current?.discardUnsyncedWork(),
  }));

  function renderLocalDataPanel() {
    if (sessionEnded) {
      return (
        <SessionEndedPanel
          layout={loadingLayout}
          work={sessionEnded.work}
          controls={sessionEndedControls}
        />
      );
    }

    if (accessRemoved) {
      return (
        <LocalDataPanel
          layout={loadingLayout}
          tone="alert"
          message="Ya no sos parte de este puesto."
          detail="Quien creó el puesto te quitó del equipo, o saliste o eliminaste tu cuenta desde otro dispositivo. Recargá la app para continuar; si quedó algo sin subir en este dispositivo, vas a poder descargar una copia."
        >
          <LocalDataPanelButton onClick={() => loadDocument("/")}>
            Recargar la app
          </LocalDataPanelButton>
        </LocalDataPanel>
      );
    }

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
          detail="Los datos locales ya se borraron. Recargá la página, o volvé para prepararlos de nuevo con la sesión actual."
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
        <LocalDataRecoveryPanel
          layout={loadingLayout}
          recovery={recovery}
          controls={recoveryPanelControls}
        />
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
        <SyncStatusStoreProvider value={syncStatusStore}>
          {localDataReady && !accessRemoved && !sessionEnded
            ? children
            : renderLocalDataPanel()}
        </SyncStatusStoreProvider>
      </OptionalPowerSyncContext.Provider>
    </PowerSyncControlsContext.Provider>
  );
}
