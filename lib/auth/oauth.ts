import type {
  LoginErrorCode,
  LoginMode,
  LoginStatusCode,
} from "@/lib/auth/login-messages";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { isAbsoluteHttpUrl } from "@/lib/invitations/validation";

export function buildAuthCallbackUrl(
  origin: string,
  next?: string
): string | null {
  const trimmedOrigin = origin.trim();
  if (!trimmedOrigin) {
    return null;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(trimmedOrigin);
  } catch {
    return null;
  }

  if (
    (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    parsedOrigin.username ||
    parsedOrigin.password
  ) {
    return null;
  }

  const base = `${parsedOrigin.origin}/auth/callback`;
  const url =
    !next || next === "/" ? base : `${base}?next=${encodeURIComponent(next)}`;

  return isAbsoluteHttpUrl(url) ? url : null;
}

export function resolveAuthRedirectPath(
  nextRaw: string | null,
  origin: string
): string {
  const isRelativeNext =
    !!nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//");

  return origin || isRelativeNext
    ? sanitizeRedirectPath(nextRaw, origin || "http://localhost")
    : "/";
}

/**
 * A /login URL that shows a known message. It takes codes, not text: the
 * page maps them to its own wording (lib/auth/login-messages.ts).
 */
export function buildLoginRedirectPath(
  params: {
    error?: LoginErrorCode;
    message?: LoginStatusCode;
    mode?: LoginMode;
  },
  next: string
): string {
  const search = new URLSearchParams();
  if (params.mode) {
    search.set("mode", params.mode);
  }
  if (params.error) {
    search.set("error", params.error);
  }
  if (params.message) {
    search.set("message", params.message);
  }
  if (next !== "/") {
    search.set("next", next);
  }

  const query = search.toString();
  return query ? `/login?${query}` : "/login";
}
