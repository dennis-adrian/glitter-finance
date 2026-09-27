import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Everything server-side runs on Node.js: proxy.ts cannot opt into the edge
  // runtime in Next.js 16, and no route sets `runtime = "edge"`. A route that
  // does would need its own Sentry.init for NEXT_RUNTIME === "edge".
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
