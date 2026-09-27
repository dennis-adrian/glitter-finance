import * as Sentry from "@sentry/nextjs";
import { assertServerEnv } from "@/lib/env";

export async function register() {
  // Everything server-side runs on Node.js: proxy.ts cannot opt into the edge
  // runtime in Next.js 16, and no route sets `runtime = "edge"`. A route that
  // does would need its own Sentry.init for NEXT_RUNTIME === "edge".
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Refuse to start without the secrets, rather than failing later on the
    // first invitation, tenant switch or image cleanup. Next.js does not run
    // register() during `next build`, so builds are unaffected.
    assertServerEnv();
  }
}

export const onRequestError = Sentry.captureRequestError;
