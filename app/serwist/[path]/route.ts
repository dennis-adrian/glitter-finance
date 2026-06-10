import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "app/sw.ts",
    globDirectory: ".",
    globPatterns: [
      "public/**/*.{js,css,html,ico,png,svg,webmanifest}",
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
      { url: "/manifest.webmanifest", revision: process.env.BUILD_ID || "1" },
    ],
    useNativeEsbuild: true,
    rebuildOnChange: true,
  });
