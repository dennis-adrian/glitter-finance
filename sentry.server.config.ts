import * as Sentry from "@sentry/nextjs";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
} from "@/lib/observability/sentry-privacy";

const configuredDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
const dsn =
  configuredDsn ||
  "https://ebc41c13114ef132f379395e1545a6b9@o4511878224150528.ingest.us.sentry.io/4511878230245376";

Sentry.init({
  dsn,
  enabled: process.env.NODE_ENV === "production" || Boolean(configuredDsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
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
});
