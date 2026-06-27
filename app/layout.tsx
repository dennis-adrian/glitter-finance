import type { Metadata, Viewport } from "next";
import { SerwistClientProvider } from "@/components/providers/serwist-client-provider";
import "./globals.css";
import { Inter, Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geistHeading = Geist({subsets:['latin'],variable:'--font-heading'});

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Glitter POS",
  description: "POS offline-first para vendedores de ferias y convenciones.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Glitter POS",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/icon-192.svg" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#6822E2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={cn("font-sans", inter.variable, geistHeading.variable)}>
      <body>
        <SerwistClientProvider>{children}</SerwistClientProvider>
      </body>
    </html>
  );
}
