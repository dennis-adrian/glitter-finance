"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import {
  StatusScreen,
  statusScreenActionClassName,
} from "@/components/templates/status-screen";

// Catches errors below the root layout, so the theme and the service worker
// provider stay mounted. app/global-error.tsx only handles the layout itself.
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <StatusScreen
      title="Algo salió mal"
      description="El error fue registrado. Puedes intentar cargar esta pantalla otra vez."
    >
      {/* retry() fetches the route from the server again; reset() would only
          re-render the payload that already failed. */}
      <button
        type="button"
        onClick={() => retry()}
        className={statusScreenActionClassName}
      >
        Intentar de nuevo
      </button>
    </StatusScreen>
  );
}
