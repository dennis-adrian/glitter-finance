"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * A screen's scroll position, kept while the screen is closed. The screen
 * saves it when it opens another one it expects to come back from (Sales
 * opening a sale's detail), and gets it back once, the next time it mounts.
 */
export type ScrollMemory = {
  save: (top: number) => void;
  /** The saved position, only once: a later visit starts at the top. */
  take: () => number | null;
};

export function createScrollMemory(): ScrollMemory {
  let saved: number | null = null;
  return {
    save(top) {
      saved = top;
    },
    take() {
      const top = saved;
      saved = null;
      return top;
    },
  };
}

/**
 * A ref for a screen's scroll container that, on mount, scrolls it back to
 * the position `memory` saved, before the screen is painted.
 */
export function useRestoredScroll<T extends HTMLElement>(memory: ScrollMemory) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const top = memory.take();
    if (top != null && ref.current) {
      ref.current.scrollTop = top;
    }
  }, [memory]);

  return ref;
}
