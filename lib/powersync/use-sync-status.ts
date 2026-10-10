"use client";

// React access to the shared sync status (see lib/powersync/sync-status.ts).
// PowerSyncProvider supplies the store for its database; every component that
// calls useSyncStatus reads the same snapshot, so the status is polled once
// no matter how many screens show it.

import { createContext, useContext, useSyncExternalStore } from "react";
import {
  idleSyncStatusStore,
  initialSyncStatusSnapshot,
  type SyncStatusSnapshot,
  type SyncStatusStore,
} from "@/lib/powersync/sync-status";

export type {
  SyncState,
  SyncStatusSnapshot,
} from "@/lib/powersync/sync-status";

const SyncStatusStoreContext =
  createContext<SyncStatusStore>(idleSyncStatusStore);

export const SyncStatusStoreProvider = SyncStatusStoreContext.Provider;

export function useSyncStatusStore(): SyncStatusStore {
  return useContext(SyncStatusStoreContext);
}

function getServerSnapshot() {
  return initialSyncStatusSnapshot;
}

export function useSyncStatus(): SyncStatusSnapshot {
  const store = useSyncStatusStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot
  );
}
