import * as Sentry from "@sentry/nextjs";
import { sentryInitOptions } from "@/lib/observability/sentry-options";

// Stalls are often offline, and the service worker never queues /monitoring.
// Events are stored in IndexedDB after beforeSend has scrubbed them, and sent
// when the device is back online or the app next opens.
const offlineTransport = Sentry.makeBrowserOfflineTransport(
  Sentry.makeFetchTransport
);

Sentry.init({
  ...sentryInitOptions(process.env.NEXT_PUBLIC_VERCEL_ENV),
  transport: (options: Parameters<typeof Sentry.makeFetchTransport>[0]) =>
    offlineTransport({ ...options, flushAtStartup: true }),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
