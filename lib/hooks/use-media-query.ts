"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Matches Tailwind's default `md` / `lg` breakpoints. */
export const TABLET_QUERY = "(min-width: 48rem)";
export const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * Subscribes to a CSS media query. Returns `false` during SSR and hydration,
 * so prefer CSS breakpoints for layout and use this only for behavior that
 * CSS can't express (drawer direction, toast position).
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
