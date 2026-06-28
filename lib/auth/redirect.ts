export function sanitizeRedirectPath(next: string | null, origin: string): string {
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
    const url = new URL(next, origin);
    if (url.origin !== origin) {
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
