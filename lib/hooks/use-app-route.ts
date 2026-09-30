"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { formatRouteHash, parseRouteHash, type AppRoute } from "@/lib/views";

// pushState/replaceState don't fire popstate or hashchange, so navigate()
// announces its own changes with this event.
const NAVIGATE_EVENT = "glitter:navigate";

type AppHistoryState = { glitterDepth?: number } | null;

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

function getHash() {
  return window.location.hash;
}

function getServerHash() {
  return "";
}

/** How many in-app entries sit below the current one in browser history. */
function currentDepth() {
  return (window.history.state as AppHistoryState)?.glitterDepth ?? 0;
}

/**
 * Hash-based routing for the single-page POS shell. Native pushState keeps
 * Next's router state (it patches history), so back/forward, refresh, and
 * deep links such as `/#/ventas/<id>` work without extra route segments.
 */
export function useAppRoute() {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  const route = useMemo(() => parseRouteHash(hash), [hash]);

  const navigate = useCallback(
    (next: AppRoute, options: { replace?: boolean } = {}) => {
      const nextHash = formatRouteHash(next);
      if (nextHash === window.location.hash) return;

      const url = `${window.location.pathname}${window.location.search}${nextHash}`;
      const depth = currentDepth();
      if (options.replace) {
        window.history.replaceState({ glitterDepth: depth }, "", url);
      } else {
        window.history.pushState({ glitterDepth: depth + 1 }, "", url);
      }
      window.dispatchEvent(new Event(NAVIGATE_EVENT));
    },
    []
  );

  /**
   * Go back one entry when it belongs to this app; otherwise (deep link or
   * fresh reload) replace the current entry with the given parent screen so
   * the back button never leaves the app unexpectedly.
   */
  const back = useCallback(
    (fallback: AppRoute) => {
      if (currentDepth() > 0) {
        window.history.back();
      } else {
        navigate(fallback, { replace: true });
      }
    },
    [navigate]
  );

  return { route, navigate, back };
}
