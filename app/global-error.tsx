"use client";

import * as Sentry from "@sentry/nextjs";
import { ClientThemeProvider } from "@wrksz/themes/client/provider";
import { useEffect } from "react";
import { SHELL_THEME_COLORS } from "@/lib/shell-theme-colors";
import { THEME_OPTIONS } from "@/lib/theme-options";
// This page replaces the root layout, and with it the layout's stylesheet and
// ThemeProvider. Importing the stylesheet brings the color tokens back, and
// ClientThemeProvider applies the stored or system theme to <html> and the
// status bar.
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // Layout and colors stay inline: if the stylesheet is missing, the tokens
  // are undefined and the page falls back to the browser's default colors,
  // which are still readable.
  return (
    <html lang="es-BO">
      <body
        style={{
          alignItems: "center",
          background: "var(--background)",
          color: "var(--foreground)",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          padding: 24,
          textAlign: "center",
        }}
      >
        <ClientThemeProvider {...THEME_OPTIONS} themeColor={SHELL_THEME_COLORS}>
          <main>
            {/* Replaces the root layout and its metadata; React hoists this
                into <head>. */}
            <title>Error · Billetera Ferial</title>
            <h1>Algo salió mal</h1>
            <p>
              El error fue registrado. Puedes intentar cargar la aplicación otra
              vez.
            </p>
            {/* retry() fetches the page from the server again; reset() would
                only re-render the payload that already failed. */}
            <button
              type="button"
              onClick={() => retry()}
              style={{
                background: "var(--primary)",
                border: 0,
                borderRadius: 10,
                color: "var(--primary-foreground)",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 600,
                padding: "12px 18px",
              }}
            >
              Intentar de nuevo
            </button>
          </main>
        </ClientThemeProvider>
      </body>
    </html>
  );
}
