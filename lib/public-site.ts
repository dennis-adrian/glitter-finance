// The public face of the app: the landing page, what search engines may index,
// and the link preview shared links show. Imported by next.config.ts, so it
// uses no "@/" imports and nothing that needs Next.js at runtime.

/**
 * The public landing page. Not "/": that is the installed PWA's start URL and
 * manifest id, and the app shell the service worker caches for offline
 * launches (lib/pwa/app-shell.ts). A 200 page at "/" for signed-out visitors
 * would be stored as that shell, and an offline launch after signing in would
 * open the landing page instead of Sell Mode. "/" sends signed-out visitors
 * here instead (app/page.tsx).
 */
export const LANDING_PATH = "/bienvenida";

/**
 * Pages search engines may index and the sitemap lists. Add the public legal
 * pages here once they exist.
 */
export const INDEXABLE_PATHS: readonly string[] = [LANDING_PATH];

/**
 * Paths answered with `X-Robots-Tag: noindex` (next.config.ts), in Next.js
 * `headers()` source syntax. They are not disallowed in robots.txt: a crawler
 * that may not fetch a URL never sees its noindex, and can still list the bare
 * URL when a link to it is public. Invitation links (/join/<token>), /login
 * (whose `next` can carry one) and the email links under /auth/ carry tokens,
 * so they must be fetched and refused rather than listed.
 */
export const NOINDEX_SOURCES: readonly string[] = [
  "/login",
  "/join/:path*",
  "/auth/:path*",
  "/api/:path*",
  "/~offline",
];

/** robots.txt Disallow lines: paths with no page and no token in them. */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/api/",
  "/serwist/",
  "/monitoring",
];

export const SITE_NAME = "Billetera Ferial";

export const SITE_DESCRIPTION =
  "Punto de venta sin conexión para vendedores de ferias y convenciones.";

/**
 * The link preview image (public/og-image.png). Regenerate it from
 * scripts/og-image.html (see the comment there) if the brand changes.
 */
export const SHARE_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Billetera Ferial: tu punto de venta para cada feria",
  type: "image/png",
} as const;

/**
 * Open Graph and Twitter fields for a page. Next.js merges metadata
 * shallowly, so a page that sets `openGraph` replaces the layout's whole
 * object: every page builds both from here, and the image comes along.
 */
export function shareMetadata(input: {
  title: string;
  description: string;
  path?: string;
}) {
  return {
    openGraph: {
      type: "website" as const,
      locale: "es_BO",
      siteName: SITE_NAME,
      title: input.title,
      description: input.description,
      ...(input.path ? { url: input.path } : {}),
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image" as const,
      title: input.title,
      description: input.description,
      images: [{ url: SHARE_IMAGE.url, alt: SHARE_IMAGE.alt }],
    },
  };
}

/** Search engines may index nothing on a Vercel preview (staging). */
export function isIndexableDeployment(env = process.env): boolean {
  return env.VERCEL_ENV !== "preview";
}
