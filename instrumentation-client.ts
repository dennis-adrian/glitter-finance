import * as Sentry from "@sentry/nextjs";
import { sentryInitOptions } from "@/lib/observability/sentry-options";

Sentry.init(sentryInitOptions(process.env.NEXT_PUBLIC_VERCEL_ENV));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
