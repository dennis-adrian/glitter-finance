import type { Breadcrumb, ErrorEvent, Event } from "@sentry/nextjs";

type SpanJSON = NonNullable<Event["spans"]>[number];
type TransactionEvent = Event & { type: "transaction" };

const INVITATION_PATH = /\/join\/[^/?#]+/g;
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
    return value
      .replace(EMBEDDED_URL, (url) => sanitizeUrl(url))
      .replace(INVITATION_PATH, "/join/[redacted]");
  }

  if (isRelativeUrl) {
    return value
      .split(/[?#]/, 1)[0]
      .replace(INVITATION_PATH, "/join/[redacted]");
  }

  try {
    const url = new URL(value, "https://local.invalid");
    const path = url.pathname.replace(INVITATION_PATH, "/join/[redacted]");
    return url.origin === "https://local.invalid"
      ? path
      : `${url.origin}${path}`;
  } catch {
    return value
      .split(/[?#]/, 1)[0]
      .replace(INVITATION_PATH, "/join/[redacted]");
  }
}

function sanitizeEvent<T extends Event>(event: T): T {
  delete event.user;

  if (event.request) {
    if (event.request.url) {
      event.request.url = sanitizeUrl(event.request.url);
    }
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
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
  if (event.transaction) {
    event.transaction = sanitizeUrl(event.transaction);
  }
  if (event.spans) {
    event.spans = event.spans.map(sanitizeSentrySpan);
  }
  return event;
}

/** Remove invitation tokens and query/fragment data from exported spans. */
export function sanitizeSentrySpan(span: SpanJSON): SpanJSON {
  if (span.description) {
    span.description = sanitizeUrl(span.description);
  }
  for (const key of SPAN_URL_FIELDS) {
    const value = span.data[key];
    if (typeof value === "string") {
      span.data[key] = sanitizeUrl(value);
    }
  }
  for (const key of [
    "http.query",
    "http.fragment",
    "url.query",
    "url.fragment",
  ]) {
    delete span.data[key];
  }
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
