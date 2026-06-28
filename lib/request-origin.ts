import { headers } from "next/headers";

// Resolves the request origin for building absolute links (auth callbacks,
// invitation links). Prefers the `Origin` header; otherwise reconstructs from
// the forwarded host + scheme. Honors `x-forwarded-proto` so links stay on the
// correct protocol behind HTTP/local deployments instead of hardcoding https.
export async function getRequestOrigin(): Promise<string> {
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (origin) {
    return origin;
  }
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
