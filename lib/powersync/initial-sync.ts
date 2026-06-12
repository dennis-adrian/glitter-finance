"use client";

const initialSyncCompletedKey = "glitter-pos-initial-sync-completed-v1";

export function hasCompletedInitialSync() {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem(initialSyncCompletedKey) === "true"
  );
}

export function markInitialSyncCompleted() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(initialSyncCompletedKey, "true");
  }
}

export function clearInitialSyncCompleted() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(initialSyncCompletedKey);
  }
}
