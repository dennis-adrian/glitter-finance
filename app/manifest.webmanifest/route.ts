import { shellThemeColorForScheme } from "@/lib/shell-theme-colors";
import { NextResponse } from "next/server";

const manifest = {
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
      purpose: "any maskable",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any maskable",
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
