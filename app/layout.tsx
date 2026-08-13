import type { Metadata, Viewport } from "next";
import { ThemeColorSync } from "@/components/atoms/theme-color-sync";
import { SerwistClientProvider } from "@/components/providers/serwist-client-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "./globals.css";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { SHELL_THEME_COLORS } from "@/lib/shell-theme-colors";
import { cn } from "@/lib/utils";

const bricolageHeading = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "800",
  variable: "--font-bricolage-grotesque",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument-sans",
});

export const metadata: Metadata = {
  title: "Billetera Ferial",
  description:
    "Punto de venta sin conexión para vendedores de ferias y convenciones.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Billetera Ferial",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SHELL_THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: SHELL_THEME_COLORS.dark },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-BO"
      className={cn(
        "font-sans",
        instrumentSans.variable,
        bricolageHeading.variable
      )}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <ThemeColorSync />
          <SerwistClientProvider>{children}</SerwistClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
