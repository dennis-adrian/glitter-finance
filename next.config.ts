import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      // Advertise the client hint app-wide so the browser starts sending it.
      {
        source: "/:path*",
        headers: [{ key: "Accept-CH", value: "Sec-CH-Prefers-Color-Scheme" }],
      },
      // Only the (color-scheme-varying) manifest response is Critical — asking
      // the browser to withhold first paint until it has the hint. Applying
      // Critical-CH app-wide would impose that cost on every route.
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Accept-CH", value: "Sec-CH-Prefers-Color-Scheme" },
          { key: "Critical-CH", value: "Sec-CH-Prefers-Color-Scheme" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
