import { createSerwistRoute } from "@serwist/turbopack";
import { OFFLINE_PAGE_URL } from "@/lib/pwa/cache-names";
import {
  offlinePageRevision,
  readOfflinePageSources,
} from "@/lib/pwa/offline-page-revision";
import {
  planPowerSyncPrecache,
  readPowerSyncAssets,
} from "@/lib/pwa/powersync-precache";

// Only the PowerSync files the app loads, including the SQLite .wasm an
// offline start needs.
const powerSyncPrecache = planPowerSyncPrecache(readPowerSyncAssets());
if (powerSyncPrecache.warning) {
  console.warn(`[serwist] ${powerSyncPrecache.warning}`);
}

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "app/sw.ts",
    globDirectory: ".",
    globPatterns: [
      "public/**/*.{js,css,html,ico,png,svg}",
      ".next/static/**/*.{js,css}",
      ...powerSyncPrecache.include,
    ],
    globIgnores: [
      "**/node_modules/**/*",
      "public/serwist/**/*",
      ...powerSyncPrecache.ignore,
      ".next/cache/**/*",
      ".next/server/**/*",
      ".next/trace",
    ],
    // The offline page is rendered by Next, not a file, so it is added here
    // with a revision derived from this build (offlinePageRevision).
    // /manifest.webmanifest is intentionally NOT precached: it varies by
    // Sec-CH-Prefers-Color-Scheme, so a single precache URL would freeze one
    // color-scheme variant as the offline response for both themes.
    manifestTransforms: [
      async (entries) => ({
        manifest: [
          ...entries,
          {
            url: OFFLINE_PAGE_URL,
            revision: offlinePageRevision({
              entries,
              sources: readOfflinePageSources(),
              commit: process.env.VERCEL_GIT_COMMIT_SHA,
            }),
            size: 0,
          },
        ],
      }),
    ],
    useNativeEsbuild: true,
    rebuildOnChange: true,
  });
