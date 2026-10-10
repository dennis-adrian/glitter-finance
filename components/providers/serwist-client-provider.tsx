"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import { useEffect } from "react";

export function SerwistClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const disableServiceWorker = process.env.NODE_ENV === "development";

  useEffect(() => {
    if (!disableServiceWorker || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        if (new URL(registration.scope).origin === window.location.origin) {
          void registration.unregister();
        }
      }
    });
  }, [disableServiceWorker]);

  return (
    // cacheOnNavigation is off: it re-fetched the current page on every
    // "online" event (a full server render of "/", with the user's sales,
    // members and invitation) into a cache nothing reads. Navigations are
    // cached by the service worker's own rule (app/sw.ts).
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={disableServiceWorker}
      cacheOnNavigation={false}
      reloadOnOnline={false}
    >
      {children}
    </SerwistProvider>
  );
}
