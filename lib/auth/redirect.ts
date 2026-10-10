// A root-relative path that a browser cannot read as a protocol-relative
// URL: `//host` and `/\host` both leave the site.
function isRootRelativePath(path: string): boolean {
  return (
    path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")
  );
}

export function sanitizeRedirectPath(
  next: string | null,
  origin: string
): string {
  const fallback = "/";

  // Block missing values, non-root-relative paths, and protocol-relative URLs
  // (`//host`). We intentionally do NOT reject paths merely containing "://"
  // (e.g. `/login?next=https://...`): the same-origin check below is the real
  // guard, and the broad reject also discards legitimate in-app query params.
  if (!next || !isRootRelativePath(next)) {
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
    // Parsing resolves dot segments (also `%2e`), turns `\` into `/` and
    // drops tabs and newlines, so an input that passed the check above can
    // come back as `//evil.com` (`/.//evil.com`, `/x/..//evil.com`). Check
    // the normalized path too: it is what callers redirect to.
    const path = `${url.pathname}${url.search}${url.hash}`;
    return isRootRelativePath(path) ? path : fallback;
  } catch {
    return fallback;
  }
}

export function isInviteRedirectPath(path: string): boolean {
  return path.startsWith("/join/");
}
