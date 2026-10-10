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

test("removes query strings and invitation tokens from request errors", () => {
  const event = {
    type: undefined,
    transaction: "GET /join/secret-token",
    request: {
      url: "https://pos.example.com/auth/callback",
      query_string: "code=oauth-code&next=%2Fjoin%2Fsecret-token",
      method: "GET",
    },
    contexts: {
      nextjs: {
        request_path: "/join/secret-token?source=whatsapp",
        router_kind: "App Router",
        router_path: "/join/[token]",
        route_type: "render",
      },
      response: {
        status_code: 500,
        headers: { location: "/join/secret-token" },
      },
    },
  } as unknown as ErrorEvent;

  const sanitized = sanitizeSentryEvent(event);

  assert.deepEqual(sanitized.request, {
    url: "https://pos.example.com/auth/callback",
    method: "GET",
  });
  assert.equal(sanitized.transaction, "GET /join/[redacted]");
  assert.deepEqual(sanitized.contexts?.nextjs, {
    request_path: "/join/[redacted]",
    router_kind: "App Router",
    router_path: "/join/[token]",
    route_type: "render",
  });
  assert.deepEqual(sanitized.contexts?.response, { status_code: 500 });
});

test("redacts percent-encoded invitation paths in free text", () => {
  const event = {
    type: undefined,
    exception: {
      values: [
        {
          type: "Error",
          value: "Redirect failed: next=%2Fjoin%2Fsecret-token&mode=signup",
        },
      ],
    },
  } as ErrorEvent;

  const sanitized = sanitizeSentryEvent(event);

  assert.equal(
    sanitized.exception?.values?.[0].value,
    "Redirect failed: next=%2Fjoin%2F[redacted]&mode=signup"
  );
});

test("removes HTTP header attributes from spans and the root span", () => {
  const headerData = {
    "http.request.header.referer": "https://pos.example.com/join/secret-token",
    "http.request.header.user_agent": "Mozilla/5.0",
    "http.response.header.set_cookie.sb_access_token": "[Filtered]",
    "http.response.status_code": 200,
    "url.full": "https://pos.example.com/join/secret-token?source=email",
  };
  const span = {
    data: { ...headerData },
    span_id: "span-1",
    start_timestamp: 1,
    trace_id: "trace-1",
  } as NonNullable<Event["spans"]>[number];
  const transaction = {
    type: "transaction",
    transaction: "GET /join/[token]",
    contexts: {
      trace: { span_id: "root", trace_id: "trace-1", data: { ...headerData } },
    },
  } as Event & { type: "transaction" };

  const expected = {
    "http.response.status_code": 200,
    "url.full": "https://pos.example.com/join/[redacted]",
  };
  assert.deepEqual(sanitizeSentrySpan(span).data, expected);
  assert.deepEqual(
    sanitizeSentryTransaction(transaction).contexts?.trace?.data,
    expected
  );
});

test("keeps the SQL of a failed query but drops its bound values", () => {
  const query =
    'insert into "sales" ("tenant_id", "user_id", "sale_discount_reason") values ($1, $2, $3)';
  const params =
    "7a000000-0000-4000-8000-000000000001,user-1,Descuento para\nDoña Ana";
  const event = {
    type: undefined,
    message: `Failed query: ${query}\nparams: ${params}`,
    exception: {
      values: [
        {
          type: "Error",
          value: `Failed query: ${query}\nparams: ${params}`,
        },
        {
          type: "PostgresError",
          value: 'duplicate key value violates unique constraint "x"',
        },
      ],
    },
    breadcrumbs: [
      {
        category: "console",
        message: `[createSale] failed Error: Failed query: ${query}\nparams: ${params}`,
      },
    ],
  } as ErrorEvent;

  const sanitized = sanitizeSentryEvent(event);

  const redacted = `Failed query: ${query}\nparams: [redacted]`;
  assert.equal(sanitized.message, redacted);
  assert.equal(sanitized.exception?.values?.[0].value, redacted);
  assert.equal(
    sanitized.exception?.values?.[1].value,
    'duplicate key value violates unique constraint "x"'
  );
  assert.equal(
    sanitized.breadcrumbs?.[0].message,
    `[createSale] failed Error: ${redacted}`
  );
});
