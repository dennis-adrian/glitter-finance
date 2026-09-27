import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmailLinkTemplate,
  EMAIL_LINK_PATH,
  parseEmailLinkType,
  resolveEmailLinkNext,
} from "@/lib/auth/email-link";
import { buildAuthCallbackUrl } from "@/lib/auth/oauth";

const ORIGIN = "http://localhost:3000";

test("accepts only Supabase email link types", () => {
  assert.equal(parseEmailLinkType("email"), "email");
  assert.equal(parseEmailLinkType("recovery"), "recovery");
  assert.equal(parseEmailLinkType("signup"), "signup");
  assert.equal(parseEmailLinkType("sms"), null);
  assert.equal(parseEmailLinkType("Email"), null);
  assert.equal(parseEmailLinkType(""), null);
  assert.equal(parseEmailLinkType(null), null);
});

test("an email link continues to the callback URL's next path", () => {
  assert.equal(
    resolveEmailLinkNext(
      "http://localhost:3000/auth/callback?next=%2Fjoin%2Finvite-123",
      ORIGIN
    ),
    "/join/invite-123"
  );
  assert.equal(
    resolveEmailLinkNext("http://localhost:3000/auth/callback", ORIGIN),
    "/"
  );
  assert.equal(
    resolveEmailLinkNext("/sales?range=today", ORIGIN),
    "/sales?range=today"
  );
  assert.equal(resolveEmailLinkNext(null, ORIGIN), "/");
  assert.equal(resolveEmailLinkNext("", ORIGIN), "/");
});

test("an email link keeps only the path of an absolute next", () => {
  // {{ .SiteURL }} can differ from the origin that asked for the email.
  assert.equal(
    resolveEmailLinkNext(
      "http://127.0.0.1:3000/auth/callback?next=%2Fjoin%2Finvite-123",
      ORIGIN
    ),
    "/join/invite-123"
  );
  assert.equal(
    resolveEmailLinkNext("https://evil.example/phish", ORIGIN),
    "/phish"
  );
});

test("an email link never redirects off this site", () => {
  for (const next of [
    "//evil.example",
    "/.//evil.example",
    "https://evil.example/.//evil.example",
    "https://evil.example//evil.example",
    "http://localhost:3000/auth/callback?next=%2F.%2F%2Fevil.example",
    "http://localhost:3000/auth/callback?next=https%3A%2F%2Fevil.example",
    "/auth/confirm?next=%2F%2Fevil.example",
    "javascript:alert(1)",
  ]) {
    const resolved = resolveEmailLinkNext(next, ORIGIN);
    assert.equal(new URL(resolved, ORIGIN).origin, ORIGIN, next);
    assert.ok(!resolved.startsWith("//"), next);
  }
});

function fillTemplate(
  template: string,
  values: { SiteURL: string; TokenHash: string; RedirectTo: string },
  escapeQueryValue: (value: string) => string
) {
  return template
    .replace("{{ .SiteURL }}", values.SiteURL)
    .replace("{{ .TokenHash }}", escapeQueryValue(values.TokenHash))
    .replace("{{ .RedirectTo }}", escapeQueryValue(values.RedirectTo));
}

test("the email template link reaches the confirm route with its next path", () => {
  const redirectTo = buildAuthCallbackUrl(
    "https://preview.example.com",
    "/join/invite-123"
  );
  assert.ok(redirectTo);

  // Go's html/template query-escapes values after `?`; a plain text
  // template would insert them as they are. Both must work.
  for (const escapeQueryValue of [
    encodeURIComponent,
    (value: string) => value,
  ]) {
    const link = new URL(
      fillTemplate(
        buildEmailLinkTemplate("email"),
        {
          SiteURL: "https://pos.example.com",
          TokenHash: "pkce_0123abcd",
          RedirectTo: redirectTo,
        },
        escapeQueryValue
      )
    );

    assert.equal(link.origin, "https://pos.example.com");
    assert.equal(link.pathname, EMAIL_LINK_PATH);
    assert.equal(link.searchParams.get("token_hash"), "pkce_0123abcd");
    assert.equal(parseEmailLinkType(link.searchParams.get("type")), "email");
    assert.equal(
      resolveEmailLinkNext(link.searchParams.get("next"), link.origin),
      "/join/invite-123"
    );
  }
});
