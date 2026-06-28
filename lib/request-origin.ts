import { headers } from "next/headers";

// Resolves the request origin for building absolute links (auth callbacks,
// invitation links).
//
// SECURITY: the base URL is constructed from the proxy-set `x-forwarded-host` /
// `x-forwarded-proto` (falling back to `Host`), NOT from the client-supplied
// `Origin` header — `Origin` is attacker-controllable and must not flow into
// generated links. When no trusted host is present, returns "" so callers do
// not build absolute URLs from an unsafe fallback. `x-forwarded-proto` is
// validated to http/https before use.
export async function getRequestOrigin(): Promise<string> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");

  if (!host) {
    return "";
  }

  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : isLocal
        ? "http"
        : "https";
  return `${proto}://${host}`;
}
