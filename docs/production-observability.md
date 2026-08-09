# Production observability

## Environment

Configure these in Vercel:

- `NEXT_PUBLIC_SENTRY_DSN` — optional runtime DSN override. The checked-in DSN
  is public and defaults production builds to the Glitter Sentry project. Use
  this override if an environment needs a separate project.
- `SENTRY_AUTH_TOKEN` — build-only source-map upload token.
- `SENTRY_ORG` and `SENTRY_PROJECT` — required when
  `NEXT_PUBLIC_SENTRY_DSN` targets another project; set them to that project's
  organization and project slugs. The Glitter defaults apply without a DSN
  override.

Never expose `SENTRY_AUTH_TOKEN` as a `NEXT_PUBLIC_*` variable.

## Collection policy

- Errors: enabled for browser, server, and edge runtimes.
- Tracing: 10% sample rate.
- Logs and Session Replay: disabled.
- User identity, request headers/cookies/bodies, query strings, and invitation
  tokens: removed before delivery.
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
