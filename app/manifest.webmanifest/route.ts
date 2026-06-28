import { shellThemeColorForScheme } from "@/lib/shell-theme-colors";
import { NextResponse } from "next/server";

const manifest = {
  name: "Glitter POS",
  short_name: "Glitter POS",
  description: "POS offline-first para vendedores de ferias y convenciones.",
  start_url: "/",
  display: "standalone" as const,
  orientation: "portrait" as const,
  icons: [
    {
      src: "/icons/icon-192.svg",
      sizes: "192x192",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
    {
      src: "/icons/icon-512.svg",
      sizes: "512x512",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
  ],
};

export async function GET(request: Request) {
  const prefersDark =
    request.headers.get("sec-ch-prefers-color-scheme") === "dark";
  const shellColor = shellThemeColorForScheme(prefersDark);

  return NextResponse.json(
    {
      ...manifest,
      background_color: shellColor,
      theme_color: shellColor,
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-cache",
        Vary: "Sec-CH-Prefers-Color-Scheme",
      },
    },
  );
}
