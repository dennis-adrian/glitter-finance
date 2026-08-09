"use client";

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { clearInitialSyncCompleted } from "@/lib/powersync/initial-sync";
import { clearLegacyDraftCartStorage } from "@/lib/powersync/draft-cart";
import { getUnresolvedSyncFailureCount } from "@/lib/powersync/sync-failures";
import { usePosStore } from "@/lib/store";

const localDataIdentityKey = "glitter-pos-local-data-identity-v1";
const pageCacheName = "glitter-pos-pages";
const localDataClearedEvent = "glitter-pos-local-data-cleared";

export type LocalDataIdentity = {
  userId: string;
  tenantId: string | null;
};

type CacheStorageLike = Pick<CacheStorage, "delete" | "keys">;

export class LocalDataTeardownError extends Error {
  constructor(
    readonly stage: "sync-failures" | "powersync" | "cache" | "storage",
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
    throw new LocalDataTeardownError(
      "cache",
      "No se puede acceder a la caché del dispositivo."
    );
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
      const deleted = await storage.delete(name);
      if (!deleted) {
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

function clearInMemoryLocalData() {
  usePosStore.getState().clearLocalData();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(localDataClearedEvent));
  }
}

export function onLocalDataCleared(listener: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(localDataClearedEvent, listener);
  return () => window.removeEventListener(localDataClearedEvent, listener);
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

  clearBrowserLocalData();
  clearInMemoryLocalData();
}
