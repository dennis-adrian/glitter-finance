"use client";

import { useEffect, useState } from "react";

/**
 * The current time in ms, refreshed every `intervalMs` while the component is
 * mounted, for what ages while a screen stays open: today's date range, a
 * sale's void window. The setter refreshes it at once, e.g. after a check
 * found that the window had just closed.
 */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return [now, setNow] as const;
}
