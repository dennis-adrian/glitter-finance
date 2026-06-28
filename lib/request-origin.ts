import { headers } from "next/headers";

// Resolves the request origin for building absolute links (auth callbacks,
// invitation links).
//
// SECURITY: the base URL is constructed from the proxy-set `x-forwarded-host` /
// `x-forwarded-proto` (falling back to `Host`), NOT from the client-supplied
// `Origin` header — `Origin` is attacker-controllable and must not flow into
// generated links. `x-forwarded-proto` is honored so links keep the correct
// scheme on HTTP/local deployments instead of hardcoding https; localhost
// defaults to http when no forwarded scheme is present.
export async function getRequestOrigin(): Promise<string> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");

  if (!host) {
    // No trusted host header to build from. Fall back to Origin only as a last
    // resort (e.g. unusual runtimes); normal deployments always carry a Host.
    return headerStore.get("origin") ?? "";
  }

  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto =
    headerStore.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}
