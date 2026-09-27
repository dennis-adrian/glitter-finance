import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
} from "@/lib/observability/sentry-privacy";

/** What both the browser and the Node.js server SDK accept. */
type SharedSentryOptions = BrowserOptions & NodeOptions;

// Public by design: a DSN only lets a client send events to the project.
const GLITTER_SENTRY_DSN =
  "https://ebc41c13114ef132f379395e1545a6b9@o4511878224150528.ingest.us.sentry.io/4511878230245376";

/**
 * Where events go and whether they are sent at all. Vercel production and
 * preview deployments report to the Glitter project, tagged with their
 * VERCEL_ENV. Everything else (`next dev`, a local production build, a
 * VERCEL_ENV=development pulled into .env.local) reports only when a DSN is
 * configured explicitly, and is tagged "local" unless Vercel names it.
 */
export function resolveSentryTarget(input: {
  vercelEnv: string | undefined;
  configuredDsn: string | undefined;
}): Pick<SharedSentryOptions, "dsn" | "enabled" | "environment"> {
  const vercelEnv = input.vercelEnv?.trim() || undefined;
  const configuredDsn = input.configuredDsn?.trim() || undefined;
  return {
    dsn: configuredDsn ?? GLITTER_SENTRY_DSN,
    enabled:
      vercelEnv === "production" ||
      vercelEnv === "preview" ||
      configuredDsn !== undefined,
    environment: vercelEnv ?? "local",
  };
}

/**
 * The init options shared by the browser and the Node.js server SDKs. Each
 * runtime passes its own view of the Vercel environment: the browser bundle
 * only has the inlined NEXT_PUBLIC_VERCEL_ENV, the server reads VERCEL_ENV.
 */
export function sentryInitOptions(vercelEnv: string | undefined) {
  return {
    ...resolveSentryTarget({
      vercelEnv,
      configuredDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    }),
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryTransaction,
    beforeSendSpan: sanitizeSentrySpan,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
  } satisfies SharedSentryOptions;
}
