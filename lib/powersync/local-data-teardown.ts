"use client";

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { clearInitialSyncCompleted } from "@/lib/powersync/initial-sync";
import { clearLegacyDraftCartStorage } from "@/lib/powersync/draft-cart";
import { resetReportedSyncFailures } from "@/lib/observability/report-sync-failure";
import {
  getUnresolvedSyncFailureCount,
  reconcileSyncFailures,
} from "@/lib/powersync/sync-failures";
import { usePosStore } from "@/lib/store";

const localDataIdentityKey = "glitter-pos-local-data-identity-v1";
const pageCacheName = "glitter-pos-pages";

/**
 * Window events that let tenant-scoped UI follow a teardown it did not start:
 * - `teardown-starting`: destructive work is about to begin; stop tenant work.
 * - `teardown-failed`: the local database was left intact; resume tenant work.
 * - `cleared`: the local user data is gone; drop tenant-derived state.
 */
const localDataEventNames = {
  "teardown-starting": "glitter-pos-local-data-teardown-starting",
  "teardown-failed": "glitter-pos-local-data-teardown-failed",
  cleared: "glitter-pos-local-data-cleared",
} as const;

export type LocalDataEvent = keyof typeof localDataEventNames;

export type LocalDataIdentity = {
  userId: string;
  tenantId: string | null;
};

type CacheStorageLike = Pick<CacheStorage, "delete" | "keys">;

const unavailableCacheStorage: CacheStorageLike = {
  delete: async () => false,
  keys: async () => [],
};

export class LocalDataTeardownError extends Error {
  constructor(
    readonly stage:
      | "sync-failures"
      | "powersync"
      | "cache"
      | "storage"
      | "post-destructive",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "LocalDataTeardownError";
  }
}

function getLocalStorage() {
  if (typeof window === "undefined") {
    throw new LocalDataTeardownError(
      "storage",
      "El almacenamiento local no está disponible."
    );
  }
  return window.localStorage;
}

function getCacheStorage(cacheStorage?: CacheStorageLike): CacheStorageLike {
  if (cacheStorage) {
    return cacheStorage;
  }
  if (typeof window === "undefined" || !("caches" in window)) {
    return unavailableCacheStorage;
  }
  return window.caches;
}

function isStaticAssetCache(name: string) {
  return (
    name === "glitter-pos-static" ||
    name.startsWith("glitter-pos-static-") ||
    name === "glitter-pos-precache" ||
    name.startsWith("glitter-pos-precache-")
  );
}

function isUserDataCache(name: string) {
  return (
    name === pageCacheName ||
    (name.startsWith("glitter-pos-") && !isStaticAssetCache(name))
  );
}

export function readLocalDataIdentity(): LocalDataIdentity | null {
  try {
    const raw = getLocalStorage().getItem(localDataIdentityKey);
    if (!raw) {
      return null;
    }
    const candidate = JSON.parse(raw) as Partial<LocalDataIdentity>;
    if (
      typeof candidate.userId !== "string" ||
      (candidate.tenantId !== null && typeof candidate.tenantId !== "string")
    ) {
      return null;
    }
    return { userId: candidate.userId, tenantId: candidate.tenantId };
  } catch {
    return null;
  }
}

export function localDataIdentityMatches(
  stored: LocalDataIdentity | null,
  current: LocalDataIdentity
) {
  return (
    stored?.userId === current.userId && stored.tenantId === current.tenantId
  );
}

export function saveLocalDataIdentity(identity: LocalDataIdentity) {
  try {
    getLocalStorage().setItem(localDataIdentityKey, JSON.stringify(identity));
  } catch (error) {
    throw new LocalDataTeardownError(
      "storage",
      "No se pudo asociar los datos locales a la sesión actual.",
      { cause: error }
    );
  }
}

export async function clearUserDataCaches(cacheStorage?: CacheStorageLike) {
  const storage = getCacheStorage(cacheStorage);
  let cacheNames: string[];
  try {
    cacheNames = await storage.keys();
  } catch (error) {
    throw new LocalDataTeardownError(
      "cache",
      "No se pudieron leer las cachés del dispositivo.",
      { cause: error }
    );
  }

  for (const name of cacheNames.filter(isUserDataCache)) {
    try {
      await storage.delete(name);
      const remainingCacheNames = await storage.keys();
      if (remainingCacheNames.includes(name)) {
        throw new Error(`Cache ${name} was not deleted`);
      }
    } catch (error) {
      throw new LocalDataTeardownError(
        "cache",
        "No se pudieron borrar los datos almacenados para esta sesión.",
        { cause: error }
      );
    }
  }
}

function clearBrowserLocalData() {
  try {
    clearInitialSyncCompleted();
    clearLegacyDraftCartStorage();
    getLocalStorage().removeItem(localDataIdentityKey);
  } catch (error) {
    throw new LocalDataTeardownError(
      "storage",
      "No se pudo limpiar el almacenamiento local.",
      { cause: error }
    );
  }
}

function emitLocalDataEvent(event: LocalDataEvent) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(localDataEventNames[event]));
  }
}

export function onLocalDataEvent(event: LocalDataEvent, listener: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const name = localDataEventNames[event];
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

function clearInMemoryLocalData() {
  usePosStore.getState().clearLocalData();
  emitLocalDataEvent("cleared");
}

/**
 * The only client-side user-data teardown path. It deliberately clears caches
 * before the local database so a failed cache deletion leaves the authenticated
 * app intact and recoverable. A caller must not end the server session unless
 * this function resolves.
 */
export async function teardownLocalUserData(input: {
  db: AbstractPowerSyncDatabase | null;
  powerSyncRequired: boolean;
  refuseWhenSyncFailuresExist: boolean;
  cacheStorage?: CacheStorageLike;
}): Promise<void> {
  const { db } = input;

  if (input.powerSyncRequired && !db) {
    throw new LocalDataTeardownError(
      "powersync",
      "La base local aún no está lista para limpiarse."
    );
  }

  if (input.refuseWhenSyncFailuresExist && db) {
    let failureCount: number;
    try {
      await reconcileSyncFailures(db);
      failureCount = await getUnresolvedSyncFailureCount(db);
    } catch (error) {
      throw new LocalDataTeardownError(
        "sync-failures",
        "No se pudo comprobar si hay operaciones pendientes de recuperación.",
        { cause: error }
      );
    }
    if (failureCount > 0) {
      throw new LocalDataTeardownError(
        "sync-failures",
        "Hay operaciones que requieren recuperación antes de limpiar los datos locales."
      );
    }
  }

  // Abort UI work before a cache or database operation yields. Local write
  // helpers re-check their assertion inside write transactions, preventing an
  // operation that was already awaiting from committing after this point.
  emitLocalDataEvent("teardown-starting");
  try {
    await clearUserDataCaches(input.cacheStorage);

    if (db) {
      try {
        await db.disconnectAndClear();
      } catch (error) {
        throw new LocalDataTeardownError(
          "powersync",
          "No se pudo borrar la base local de este dispositivo.",
          { cause: error }
        );
      }
    }
  } catch (error) {
    emitLocalDataEvent("teardown-failed");
    throw error;
  }

  resetReportedSyncFailures();

  let postDestructiveError: unknown = null;
  try {
    clearBrowserLocalData();
  } catch (error) {
    postDestructiveError = error;
  }

  try {
    clearInMemoryLocalData();
  } catch (error) {
    postDestructiveError ??= error;
  }

  if (postDestructiveError) {
    throw new LocalDataTeardownError(
      "post-destructive",
      postDestructiveError instanceof Error
        ? postDestructiveError.message
        : "No se pudo completar la limpieza local.",
      { cause: postDestructiveError }
    );
  }
}
