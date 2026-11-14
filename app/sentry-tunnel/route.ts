// The `tunnelRoute` ("/monitoring" in next.config.ts) is rewritten here. With
// this file, @sentry/nextjs forwards only the event payload to Sentry, never
// the request headers, so the browser can send its cookies (which Vercel
// Deployment Protection needs) without the Supabase session reaching Sentry.
// It accepts only the server SDK's DSN, the same one the browser uses
// (lib/observability/sentry-options.ts).
export { POST } from "@sentry/nextjs/tunnel";
