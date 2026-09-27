import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import { withSentryConfig } from "@sentry/nextjs";

// Defense-in-depth headers for every response. A full Content-Security-Policy
// is deliberately left out until it has been tested against Supabase,
// PowerSync (workers and WASM), Sentry and the Serwist service worker; the
// policy below only forbids framing. Vercel already sends HSTS.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Features the app does not use. Allow one here (e.g. camera=(self))
  // before shipping code that needs it.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Without PowerSync, a product photo reaches Storage through the
      // uploadProductImage action, whose body Next caps at 1 MB by default.
      // The editor reduces photos first, but a large transparent PNG, or a
      // photo the browser could not reduce, can still be bigger, up to the
      // productImageMaxBytes (5 MB) Storage accepts. The extra 1 MB covers
      // the multipart overhead. Vercel refuses request bodies over 4.5 MB
      // before they reach the action, so there the largest photos still fail
      // (the product itself is saved first, on its own).
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          // Advertise the client hint app-wide. Browsers only act on
          // Accept-CH from the page (navigation) response, which then makes
          // them send the hint on the color-scheme-varying manifest request.
          { key: "Accept-CH", value: "Sec-CH-Prefers-Color-Scheme" },
        ],
      },
    ];
  },
};

const sentrySourceMapsEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN);
const hasAlternateSentryDsn = Boolean(
  process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
);

export default withSentryConfig(withSerwist(nextConfig), {
  org:
    process.env.SENTRY_ORG ??
    (hasAlternateSentryDsn ? undefined : "glitter-v2"),
  project:
    process.env.SENTRY_PROJECT ??
    (hasAlternateSentryDsn ? undefined : "javascript-nextjs"),
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  sourcemaps: {
    disable: !sentrySourceMapsEnabled,
    deleteSourcemapsAfterUpload: true,
  },
  // No `webpack` options: `next build` uses Turbopack, which ignores them.
});
