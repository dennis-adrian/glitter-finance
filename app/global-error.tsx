"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          alignItems: "center",
          background: "#f8f7fb",
          color: "#211a2e",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          padding: 24,
          textAlign: "center",
        }}
      >
        <main>
          <h1>Algo salió mal</h1>
          <p>
            El error fue registrado. Puedes intentar cargar la aplicación otra
            vez.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#6822e2",
              border: 0,
              borderRadius: 10,
              color: "white",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
              padding: "12px 18px",
            }}
          >
            Intentar de nuevo
          </button>
        </main>
      </body>
    </html>
  );
}
