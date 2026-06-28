export function sanitizeRedirectPath(
  next: string | null,
  origin: string
): string {
  const fallback = "/";

  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("://")
  ) {
    return fallback;
  }

  try {
    // Normalize the caller-provided origin (e.g. strip a default :443/:80)
    // before comparing, so a same-origin URL isn't misjudged as external.
    const normalizedOrigin = new URL(origin).origin;
    const url = new URL(next, normalizedOrigin);
    if (url.origin !== normalizedOrigin) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function isInviteRedirectPath(path: string): boolean {
  return path.startsWith("/join/");
}
