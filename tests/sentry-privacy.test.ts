import assert from "node:assert/strict";
import test from "node:test";
import type { ErrorEvent, Event } from "@sentry/nextjs";
import {
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
} from "@/lib/observability/sentry-privacy";

test("removes request identity, credentials, bodies, and URL secrets", () => {
  const event = {
    type: undefined,
    user: { id: "user-1", email: "person@example.com" },
    exception: {
      values: [
        {
          type: "Error",
          value: "Request failed for /join/secret-token",
          mechanism: { type: "generic", handled: true },
        },
      ],
    },
    request: {
      url: "https://pos.example.com/join/secret-token?email=person@example.com",
      headers: { authorization: "Bearer secret" },
      cookies: { session: "secret" },
      data: { payment: "private" },
    },
    breadcrumbs: [
      {
        category: "navigation",
        data: {
          from: "/login?next=/join/secret-token",
          to: "/join/another-token#fragment",
        },
      },
      {
        category: "console",
        message: "PowerSync upload failed",
        data: {
          arguments: [{ total_cents: 1000, tenant_id: "tenant-1" }],
          body: { payment_method: "cash" },
        },
      },
    ],
  } as ErrorEvent;

  const sanitized = sanitizeSentryEvent(event);

  assert.equal(sanitized.user, undefined);
  assert.equal(
    sanitized.exception?.values?.[0].value,
    "Request failed for /join/[redacted]"
  );
  assert.deepEqual(sanitized.exception?.values?.[0].mechanism, {
    type: "generic",
    handled: true,
  });
  assert.deepEqual(sanitized.request, {
    url: "https://pos.example.com/join/[redacted]",
  });
  assert.deepEqual(sanitized.breadcrumbs?.[0].data, {
    from: "/login",
    to: "/join/[redacted]",
  });
  assert.equal(sanitized.breadcrumbs?.[1].message, "PowerSync upload failed");
  assert.deepEqual(sanitized.breadcrumbs?.[1].data, {});
});

test("removes invitation tokens from transaction names and child-span URLs", () => {
  const spanData = {
    url: "/join/secret-token?email=person@example.com",
    "http.url": "https://pos.example.com/join/secret-token?source=email",
    "url.full": "https://pos.example.com/join/secret-token#invite",
    "http.query": "?email=person@example.com",
  };
  const span = {
    data: { ...spanData },
    description: "GET https://pos.example.com/join/secret-token?source=email",
    span_id: "span-1",
    start_timestamp: 1,
    trace_id: "trace-1",
  } as NonNullable<Event["spans"]>[number];
  const standaloneSpan = {
    ...span,
    data: { ...spanData },
    span_id: "span-2",
  } as NonNullable<Event["spans"]>[number];
  const transaction = {
    type: "transaction",
    transaction: "/join/secret-token",
    spans: [span],
  } as Event & { type: "transaction" };

  const sanitizedTransaction = sanitizeSentryTransaction(transaction);
  const sanitizedSpan = sanitizeSentrySpan(standaloneSpan);

  assert.equal(sanitizedTransaction.transaction, "/join/[redacted]");
  assert.equal(sanitizedTransaction.spans?.[0].data.url, "/join/[redacted]");
  assert.equal(
    sanitizedSpan.data["http.url"],
    "https://pos.example.com/join/[redacted]"
  );
  assert.equal(
    sanitizedSpan.data["url.full"],
    "https://pos.example.com/join/[redacted]"
  );
  assert.equal(
    sanitizedSpan.description,
    "GET https://pos.example.com/join/[redacted]"
  );
  assert.equal(sanitizedSpan.data["http.query"], undefined);
});

test("removes query strings from relative and embedded URLs", () => {
  const event = {
    type: undefined,
    exception: {
      values: [
        {
          type: "Error",
          value: "Request failed for https://host/path?token=secret",
        },
      ],
    },
    breadcrumbs: [
      {
        category: "navigation",
        data: { from: "login?token=secret" },
      },
    ],
  } as ErrorEvent;

  const sanitized = sanitizeSentryEvent(event);

  assert.equal(
    sanitized.exception?.values?.[0].value,
    "Request failed for https://host/path"
  );
  assert.equal(sanitized.breadcrumbs?.[0].data?.from, "login");
});
