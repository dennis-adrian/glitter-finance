# Production observability

## Environment

Configure these in Vercel:

- `NEXT_PUBLIC_SENTRY_DSN` — optional DSN override. The checked-in DSN is
  public; Vercel production and preview deployments report to the Glitter
  Sentry project with it. Use this override if an environment needs a separate
  project.
- `SENTRY_AUTH_TOKEN` — build-only source-map upload token.
- `SENTRY_ORG` and `SENTRY_PROJECT` — required when
  `NEXT_PUBLIC_SENTRY_DSN` targets another project; set them to that project's
  organization and project slugs. The Glitter defaults apply without a DSN
  override.

Never expose `SENTRY_AUTH_TOKEN` as a `NEXT_PUBLIC_*` variable.

Reporting is on only where `VERCEL_ENV` is `production` or `preview`, and
events carry that value as their environment. The browser reads it from
`NEXT_PUBLIC_VERCEL_ENV`, so keep Vercel's “Automatically expose System
Environment Variables” enabled. Anywhere else, including `next dev` and a
local `pnpm build && pnpm start`, Sentry stays off unless
`NEXT_PUBLIC_SENTRY_DSN` is set; those events are tagged `local`. The shared
init options live in `lib/observability/sentry-options.ts`.

## Collection policy

- Errors: enabled for the browser and the Node.js server (pages, route
  handlers, server actions and `proxy.ts`). Nothing runs on the edge runtime,
  so there is no edge configuration.
- Tracing: 10% sample rate.
- Logs and Session Replay: disabled.
- User identity, cookies, HTTP headers, request/response bodies, URL query
  strings and database query values: not collected (every `dataCollection`
  category is off). The `beforeSend*` scrubbers in
  `lib/observability/sentry-privacy.ts` remove them again before delivery,
  together with invitation tokens (`/join/<token>`, also percent-encoded) in
  URLs, messages, span data and the Next.js request path.
- Permanent PowerSync upload failures: report only transaction metadata, table
  names, operation types, and PostgreSQL error code. Financial row payloads and
  tenant/user identifiers remain local.

## Sentry dashboard setup

1. Create an issue alert for newly seen errors, delivered by email.
2. Create an alert for `component:powersync_upload` at one or more events in
   five minutes.
3. Create the free uptime monitor against `https://<production-host>/api/health`.
4. After each release, confirm a source-mapped event appears with the correct
   environment and release.

`/api/health` proves the Next.js deployment responds. It intentionally does not
query Supabase or PowerSync, avoiding false outages during brief dependency
interruptions.
