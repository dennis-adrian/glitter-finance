import type { Metadata, Viewport } from "next";
import { ThemeColorSync } from "@/components/atoms/theme-color-sync";
import { SerwistClientProvider } from "@/components/providers/serwist-client-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "./globals.css";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { shareMetadata, SITE_DESCRIPTION, SITE_NAME } from "@/lib/public-site";
import { configuredPublicOrigin } from "@/lib/request-origin";
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

const publicOrigin = configuredPublicOrigin();

export const metadata: Metadata = {
  // Configuration only, never request headers: those would make every page
  // dynamic, the precached offline page included. Unset, Next.js falls back
  // to the Vercel URLs or localhost.
  ...(publicOrigin ? { metadataBase: new URL(publicOrigin) } : {}),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  // Every page, invitation links included, previews as the app; no `url`,
  // so a preview never repeats a link's token.
  ...shareMetadata({ title: SITE_NAME, description: SITE_DESCRIPTION }),
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
  // No maximumScale: pinch zoom stays available. Form fields use 16px text
  // on phones (components/ui/input.tsx), so iOS does not zoom in on focus.
  // Android Chrome: shrink the layout when the keyboard opens so the shell
  // (sized in dvh) stays above it. iOS ignores this; useVirtualKeyboard
  // covers it with the VisualViewport API.
  interactiveWidget: "resizes-content",
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
