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
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={disableServiceWorker}
      reloadOnOnline={false}
    >
      {children}
    </SerwistProvider>
  );
}
