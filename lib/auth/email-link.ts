import type { EmailOtpType } from "@supabase/supabase-js";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { isAbsoluteHttpUrl } from "@/lib/invitations/validation";

/**
 * Where the links in Supabase's auth emails land (app/auth/confirm).
 *
 * The link carries a token hash that verifyOtp exchanges for a session, so
 * it works in any browser: the installed iOS PWA (which has its own cookie
 * jar), an email app's in-app browser or another device. Supabase's default
 * {{ .ConfirmationURL }} goes through a PKCE code exchange instead, which
 * needs the code verifier cookie that only the browser that asked for the
 * email has.
 */
export const EMAIL_LINK_PATH = "/auth/confirm";

const EMAIL_LINK_TYPES = [
  "email",
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
] as const satisfies readonly EmailOtpType[];

export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

export function parseEmailLinkType(value: string | null): EmailLinkType | null {
  return EMAIL_LINK_TYPES.find((type) => type === value) ?? null;
}

/**
 * The link for a Supabase email template, with its Go template variables.
 * `next` is {{ .RedirectTo }}: the absolute emailRedirectTo / redirectTo URL
 * the app sent with the request, which resolveEmailLinkNext turns back into
 * a path on this site.
 */
export function buildEmailLinkTemplate(type: "email" | "recovery"): string {
  return `{{ .SiteURL }}${EMAIL_LINK_PATH}?token_hash={{ .TokenHash }}&type=${type}&next={{ .RedirectTo }}`;
}

// Routes that only pass the user on to their own `next`. The app sends its
// OAuth callback URL as the redirect URL (the hosted redirect allow lists
// already accept it, and emails still using {{ .ConfirmationURL }} need it),
// so the confirmed link goes straight to the callback's `next`.
const PASS_THROUGH_PATHS = new Set(["/auth/callback", EMAIL_LINK_PATH]);

/**
 * The path an email link continues to once it is verified.
 *
 * `next` is usually an absolute URL ({{ .RedirectTo }}). Only its path is
 * kept: the link's host is {{ .SiteURL }}, which can differ from the origin
 * that asked for the email (a preview deployment, localhost versus
 * 127.0.0.1), and dropping the origin also keeps a crafted `next` on this
 * site.
 */
export function resolveEmailLinkNext(
  nextRaw: string | null,
  origin: string
): string {
  let candidate = nextRaw;
  if (candidate && isAbsoluteHttpUrl(candidate)) {
    const url = new URL(candidate);
    candidate = `${url.pathname}${url.search}${url.hash}`;
  }

  const next = sanitizeRedirectPath(candidate, origin);
  // Any base works here: only the path and query are read.
  const url = new URL(next, "http://localhost");
  return PASS_THROUGH_PATHS.has(url.pathname)
    ? sanitizeRedirectPath(url.searchParams.get("next"), origin)
    : next;
}
