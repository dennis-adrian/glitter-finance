import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      // Advertise the client hint app-wide so the browser starts sending it.
      {
        source: "/:path*",
        headers: [{ key: "Accept-CH", value: "Sec-CH-Prefers-Color-Scheme" }],
      },
      // Only the (color-scheme-varying) manifest response is Critical — asking
      // the browser to withhold first paint until it has the hint. Applying
      // Critical-CH app-wide would impose that cost on every route.
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Accept-CH", value: "Sec-CH-Prefers-Color-Scheme" },
          { key: "Critical-CH", value: "Sec-CH-Prefers-Color-Scheme" },
        ],
      },
    ];
  },
};

const sentrySourceMapsEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG ?? "glitter-v2",
  project: process.env.SENTRY_PROJECT ?? "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  sourcemaps: {
    disable: !sentrySourceMapsEnabled,
    deleteSourcemapsAfterUpload: true,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
