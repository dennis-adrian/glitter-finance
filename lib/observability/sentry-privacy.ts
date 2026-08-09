import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const INVITATION_PATH = /\/join\/[^/?#]+/g;

function sanitizeUrl(value: string): string {
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

/** Remove identity, credentials, request bodies, and invitation tokens. */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
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

  return event;
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
