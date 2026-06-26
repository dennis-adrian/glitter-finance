"use client";

const initialSyncCompletedKey = "glitter-pos-initial-sync-completed-v1";
// Transitional read: a brief v2 bump shipped during Stage D; accept either key
// so upgraded devices keep offline-first products/sales watches.
const transitionalInitialSyncCompletedKey =
  "glitter-pos-initial-sync-completed-v2";

export function hasCompletedInitialSync() {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.localStorage.getItem(initialSyncCompletedKey) === "true" ||
    window.localStorage.getItem(transitionalInitialSyncCompletedKey) === "true"
  );
}

export function markInitialSyncCompleted() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(initialSyncCompletedKey, "true");
    window.localStorage.removeItem(transitionalInitialSyncCompletedKey);
  }
}

export function clearInitialSyncCompleted() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(initialSyncCompletedKey);
    window.localStorage.removeItem(transitionalInitialSyncCompletedKey);
  }
}
