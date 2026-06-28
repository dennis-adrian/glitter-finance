import { headers } from "next/headers";

// Resolves the request origin for building absolute links (auth callbacks,
// invitation links).
//
// SECURITY: prefer a configured public origin; otherwise use proxy-set
// `x-forwarded-host` / `x-forwarded-proto` (falling back to `Host`), NOT the
// client-supplied `Origin` header. The host must pass an allow-list before it
// is used. When no trusted host is present, returns "" so callers do not build
// absolute URLs from an unsafe fallback. `x-forwarded-proto` is validated to
// http/https before use.
export async function getRequestOrigin(): Promise<string> {
  const configured = configuredPublicOrigin();
  if (configured) {
    return configured;
  }

  const headerStore = await headers();
  const rawHost =
    headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const host = normalizeHost(rawHost);

  if (!host || !isAllowedHost(host)) {
    return "";
  }

  const isLocal = isLoopbackHost(host);
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : isLocal
        ? "http"
        : "https";
  return `${proto}://${host}`;
}

function configuredPublicOrigin(): string | null {
  for (const key of ["NEXT_PUBLIC_APP_URL", "APP_URL"] as const) {
    const raw = process.env[key]?.trim();
    if (!raw) {
      continue;
    }
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        continue;
      }
      const host = normalizeHost(url.host);
      if (!host || !isAllowedHost(host)) {
        continue;
      }
      const port = url.port;
      const hostWithPort = port ? `${host}:${port}` : host;
      return `${url.protocol}//${hostWithPort}`;
    } catch {
      continue;
    }
  }
  return null;
}

function allowedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const key of ["NEXT_PUBLIC_APP_URL", "APP_URL"] as const) {
    const raw = process.env[key]?.trim();
    if (!raw) {
      continue;
    }
    try {
      const host = normalizeHost(new URL(raw).host);
      if (host) {
        hosts.add(host);
      }
    } catch {
      continue;
    }
  }
  return hosts;
}

function normalizeHost(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const primary = raw.split(",")[0]?.trim();
  if (!primary) {
    return null;
  }
  const withoutPort = primary.replace(/:\d+$/, "");
  const host = withoutPort.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return null;
  }
  return host;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}

function isAllowedHost(host: string): boolean {
  if (isLoopbackHost(host)) {
    return true;
  }
  return allowedHosts().has(host);
}
