import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "app/sw.ts",
    globDirectory: ".",
    globPatterns: [
      "public/**/*.{js,css,html,ico,png,svg}",
      ".next/static/**/*.{js,css}",
    ],
    globIgnores: [
      "**/node_modules/**/*",
      "public/serwist/**/*",
      ".next/cache/**/*",
      ".next/server/**/*",
      ".next/trace",
    ],
    additionalPrecacheEntries: [
      { url: "/~offline", revision: process.env.BUILD_ID || "1" },
      // /manifest.webmanifest is intentionally NOT precached: it varies by
      // Sec-CH-Prefers-Color-Scheme, so a single precache URL would freeze one
      // color-scheme variant as the offline response for both themes.
    ],
    useNativeEsbuild: true,
    rebuildOnChange: true,
  });
