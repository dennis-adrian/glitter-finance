"use client";

import { useMemo, useSyncExternalStore } from "react";
import { formatRouteHash, parseRouteHash, type AppRoute } from "@/lib/views";

// pushState/replaceState don't fire popstate or hashchange, so navigate()
// announces its own changes with this event.
const NAVIGATE_EVENT = "glitter:navigate";

type AppHistoryState = { glitterDepth?: number } | null;

// Set while a history.back() started by the app is on its way, so a second
// back() (a double tap) can't go back past the screen below.
let appTraversalPending = false;

/** A held screen: its hash, and its confirmation while it would ask. */
type BackGuard = {
  hash: string;
  getConfirm: () => ((leave: () => void) => void) | null;
};

// The screen guardHistoryBack holds. The app's own navigation drops it:
// the app asks before navigating away.
let backGuard: BackGuard | null = null;

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

/**
 * The hash the app renders: a held screen's while it would ask before
 * leaving. Browsers can re-render between committing a Back and firing
 * popstate, so the held screen must not see the new hash before
 * guardHistoryBack puts its entry back.
 */
export function currentRouteHash() {
  if (backGuard?.getConfirm()) return backGuard.hash;
  return window.location.hash;
}

function getServerHash() {
  return "";
}

/** How many in-app entries sit below the current one in browser history. */
function currentDepth() {
  return (window.history.state as AppHistoryState)?.glitterDepth ?? 0;
}

function appUrl(hash: string) {
  return `${window.location.pathname}${window.location.search}${hash}`;
}

export function navigateTo(
  next: AppRoute,
  options: { replace?: boolean } = {}
) {
  const nextHash = formatRouteHash(next);
  if (nextHash === window.location.hash) return;

  backGuard = null;
  const url = appUrl(nextHash);
  const depth = currentDepth();
  if (options.replace) {
    window.history.replaceState({ glitterDepth: depth }, "", url);
  } else {
    window.history.pushState({ glitterDepth: depth + 1 }, "", url);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function traverseBack() {
  if (appTraversalPending) return;
  appTraversalPending = true;
  backGuard = null;
  // pageshow too: an entry from before a reload loads its own document, so
  // no popstate reaches this one, and a page restored from the back/forward
  // cache would keep the flag set and ignore every later back().
  const done = () => {
    appTraversalPending = false;
    window.removeEventListener("popstate", done);
    window.removeEventListener("pageshow", done);
  };
  window.addEventListener("popstate", done);
  window.addEventListener("pageshow", done);
  window.history.back();
}

/**
 * Go back one entry when it belongs to this app; otherwise (deep link or
 * fresh reload) replace the current entry with the given parent screen so
 * the back button never leaves the app unexpectedly.
 */
export function goBack(fallback: AppRoute) {
  if (currentDepth() > 0) {
    traverseBack();
  } else {
    navigateTo(fallback, { replace: true });
  }
}

/**
 * Lets the current screen catch the browser's or the phone's Back (and
 * Forward, or an edited hash) while it has unsaved work. `getConfirm`
 * returns null while leaving is fine, or the screen's confirmation, which
 * gets a `leave` callback that finishes the traversal. A held traversal
 * puts the screen's entry back on top, so the screen stays mounted with its
 * state. The app's own navigate() and back() drop the hold. Returns the
 * cleanup.
 */
export function guardHistoryBack(getConfirm: BackGuard["getConfirm"]) {
  const guard: BackGuard = { hash: window.location.hash, getConfirm };
  backGuard = guard;

  const onTraversal = () => {
    if (backGuard !== guard || window.location.hash === guard.hash) return;
    const confirm = getConfirm();
    if (!confirm) return;

    // The entry the vendor landed on stays below, so `leave` goes back to
    // it, whichever way (or however far) they moved.
    window.history.pushState(
      { glitterDepth: currentDepth() + 1 },
      "",
      appUrl(guard.hash)
    );
    confirm(traverseBack);
  };
  // Capture runs before the route store's own listeners.
  window.addEventListener("popstate", onTraversal, { capture: true });
  window.addEventListener("hashchange", onTraversal, { capture: true });
  return () => {
    if (backGuard === guard) backGuard = null;
    window.removeEventListener("popstate", onTraversal, { capture: true });
    window.removeEventListener("hashchange", onTraversal, { capture: true });
  };
}

/**
 * Hash-based routing for the single-page POS shell. Native pushState keeps
 * Next's router state (it patches history), so back/forward, refresh, and
 * deep links such as `/#/ventas/<id>` work without extra route segments.
 */
export function useAppRoute() {
  const hash = useSyncExternalStore(subscribe, currentRouteHash, getServerHash);
  const route = useMemo(() => parseRouteHash(hash), [hash]);

  return { route, navigate: navigateTo, back: goBack };
}
