import { shellThemeColorForScheme } from "@/lib/shell-theme-colors";
import { NextResponse } from "next/server";

const manifest = {
  // Chrome derived the id from start_url until now, so "/" keeps existing
  // installs the same app if start_url ever changes.
  id: "/",
  lang: "es-BO",
  name: "Billetera Ferial",
  short_name: "Billetera Ferial",
  description:
    "Punto de venta sin conexión para vendedores de ferias y convenciones.",
  start_url: "/",
  display: "standalone" as const,
  orientation: "portrait" as const,
  icons: [
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    // Full-bleed squares with the artwork inside the 80% safe zone, so any
    // launcher mask crops background rather than the rounded corners.
    {
      src: "/icons/icon-maskable-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

export async function GET(request: Request) {
  const rawScheme = request.headers.get("sec-ch-prefers-color-scheme");
  const prefersDark =
    rawScheme?.replace(/^"|"$/g, "").trim().toLowerCase() === "dark";
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
    }
  );
}
