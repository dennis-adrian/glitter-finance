import assert from "node:assert/strict";
import test from "node:test";
import type { ErrorEvent } from "@sentry/nextjs";
import { sanitizeSentryEvent } from "@/lib/observability/sentry-privacy";

test("removes request identity, credentials, bodies, and URL secrets", () => {
  const event = {
    type: undefined,
    user: { id: "user-1", email: "person@example.com" },
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
  assert.deepEqual(sanitized.request, {
    url: "https://pos.example.com/join/[redacted]",
  });
  assert.deepEqual(sanitized.breadcrumbs?.[0].data, {
    from: "/login",
    to: "/join/[redacted]",
  });
  assert.deepEqual(sanitized.breadcrumbs?.[1].data, {});
});
