import type { Breadcrumb, ErrorEvent, Event } from "@sentry/nextjs";

type SpanJSON = NonNullable<Event["spans"]>[number];
type TransactionEvent = Event & { type: "transaction" };

// Also matches the percent-encoded form, e.g. `next=%2Fjoin%2F<token>`.
const INVITATION_PATH = /(\/|%2F)join(\/|%2F)[^/?#&%\s]+/gi;
const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//i;
const EMBEDDED_URL = /(?:[a-z][a-z\d+.-]*:\/\/|\/)[^\s]+/gi;
const SPAN_URL_FIELDS = [
  "url",
  "http.url",
  "url.full",
  "url.path",
  "http.target",
  "http.route",
] as const;
const SPAN_QUERY_FIELDS = [
  "http.query",
  "http.fragment",
  "url.query",
  "url.fragment",
] as const;
// http.request.header.referer can hold a /join/<token> URL, and other
// headers can hold credentials.
const SPAN_HEADER_PREFIXES = [
  "http.request.header.",
  "http.response.header.",
] as const;

function redactInvitationPaths(value: string): string {
  return value.replace(
    INVITATION_PATH,
    (_path, before: string, after: string) => `${before}join${after}[redacted]`
  );
}

function sanitizeUrl(value: string): string {
  const methodAndUrl = value.match(
    /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/
  );
  if (methodAndUrl) {
    return `${methodAndUrl[1]} ${sanitizeUrl(methodAndUrl[2])}`;
  }

  const isRelativeUrl =
    !value.startsWith("/") &&
    !ABSOLUTE_URL.test(value) &&
    !value.includes(" ") &&
    /[?#]/.test(value);
  if (!value.startsWith("/") && !ABSOLUTE_URL.test(value) && !isRelativeUrl) {
    return redactInvitationPaths(
      value.replace(EMBEDDED_URL, (url) => sanitizeUrl(url))
    );
  }

  if (isRelativeUrl) {
    return redactInvitationPaths(value.split(/[?#]/, 1)[0]);
  }

  try {
    const url = new URL(value, "https://local.invalid");
    const path = redactInvitationPaths(url.pathname);
    return url.origin === "https://local.invalid"
      ? path
      : `${url.origin}${path}`;
  } catch {
    return redactInvitationPaths(value.split(/[?#]/, 1)[0]);
  }
}

function sanitizeSpanData(data: Record<string, unknown>) {
  for (const key of SPAN_URL_FIELDS) {
    const value = data[key];
    if (typeof value === "string") {
      data[key] = sanitizeUrl(value);
    }
  }
  for (const key of SPAN_QUERY_FIELDS) {
    delete data[key];
  }
  for (const key of Object.keys(data)) {
    if (SPAN_HEADER_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete data[key];
    }
  }
}

function sanitizeEvent<T extends Event>(event: T): T {
  delete event.user;

  if (event.request) {
    if (event.request.url) {
      event.request.url = sanitizeUrl(event.request.url);
    }
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
  }

  if (event.transaction) {
    event.transaction = sanitizeUrl(event.transaction);
  }

  const contexts = event.contexts;
  if (contexts) {
    // Set by captureRequestError (instrumentation.ts) to the request path,
    // query string included.
    const nextjs = contexts.nextjs;
    if (nextjs && typeof nextjs.request_path === "string") {
      nextjs.request_path = sanitizeUrl(nextjs.request_path);
    }
    if (contexts.response) {
      delete contexts.response.headers;
      delete contexts.response.cookies;
    }
    if (contexts.trace?.data) {
      sanitizeSpanData(contexts.trace.data);
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) =>
      sanitizeSentryBreadcrumb(breadcrumb)
    );
  }

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = sanitizeUrl(exception.value);
    }
  }

  return event;
}

/** Remove identity, credentials, request bodies, and invitation tokens. */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  return sanitizeEvent(event);
}

/** Remove invitation tokens from transaction names and their child spans. */
export function sanitizeSentryTransaction(
  event: TransactionEvent
): TransactionEvent {
  sanitizeEvent(event);
  if (event.spans) {
    event.spans = event.spans.map(sanitizeSentrySpan);
  }
  return event;
}

/**
 * Remove invitation tokens, query/fragment data and HTTP headers from
 * exported spans.
 */
export function sanitizeSentrySpan(span: SpanJSON): SpanJSON {
  if (span.description) {
    span.description = sanitizeUrl(span.description);
  }
  sanitizeSpanData(span.data);
  return span;
}

/** Keep navigation/network breadcrumbs useful without retaining URL secrets. */
export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) {
    breadcrumb.message = sanitizeUrl(breadcrumb.message);
  }

  if (breadcrumb.data) {
    for (const key of [
      "arguments",
      "body",
      "request_body",
      "requestBody",
      "headers",
      "cookies",
    ]) {
      delete breadcrumb.data[key];
    }

    for (const key of ["url", "from", "to"]) {
      const value = breadcrumb.data[key];
      if (typeof value === "string") {
        breadcrumb.data[key] = sanitizeUrl(value);
      }
    }
  }

  return breadcrumb;
}
