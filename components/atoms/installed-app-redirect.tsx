"use client";

import { useEffect } from "react";

/** True when the page runs as the installed PWA rather than in a browser tab. */
export function isInstalledApp(
  matchMedia: (query: string) => { matches: boolean },
  navigator: { standalone?: boolean }
): boolean {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for a web app added to the home screen.
    navigator.standalone === true
  );
}

/**
 * "/" sends a signed-out visitor to the landing page. The installed app opens
 * "/" too, and someone who opens it signed out (after logging out, or once
 * the session lapsed) came to sign in, not to read about the app: send them
 * on to /login, as "/" did before the landing page existed.
 */
export function InstalledAppRedirect({ to }: { to: string }) {
  useEffect(() => {
    if (
      isInstalledApp(
        (query) => window.matchMedia(query),
        window.navigator as Navigator & { standalone?: boolean }
      )
    ) {
      window.location.replace(to);
    }
  }, [to]);

  return null;
}
