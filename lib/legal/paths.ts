// The public legal pages. This file has no imports because the service
// worker bundle (app/sw.ts) includes it. proxy.ts repeats the two paths in
// its matcher, which Next.js reads as a literal (tests/proxy-matcher.test.ts
// checks they agree).

export const TERMS_PATH = "/terminos";
export const PRIVACY_PATH = "/privacidad";

export const LEGAL_PAGE_PATHS = [TERMS_PATH, PRIVACY_PATH] as const;

/** True for a legal page, with or without a trailing slash. */
export function isLegalPagePath(pathname: string) {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return (LEGAL_PAGE_PATHS as readonly string[]).includes(normalized);
}
