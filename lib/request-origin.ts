import { headers } from "next/headers";

// Resolves the request origin for building absolute links (auth callbacks,
// invitation links).
//
// SECURITY: prefer a configured public origin; on Vercel preview deployments
// prefer branch/deployment URLs so invite links match the current deployment.
// Otherwise use proxy-set `x-forwarded-host` / `x-forwarded-proto` (falling back
// to `Host`), NOT the client-supplied `Origin` header. The host must pass an
// allow-list before it is used. When no trusted host is present, returns "" so
// callers do not build absolute URLs from an unsafe fallback.
// `x-forwarded-proto` is validated to http/https before use.
export async function getRequestOrigin(): Promise<string> {
  const configured = configuredPublicOrigin();
  if (configured) {
    return configured;
  }

  const headerStore = await headers();
  const rawHost =
    headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const parsed = parseHostHeader(rawHost);

  if (!parsed || !isAllowedHost(parsed.host)) {
    return "";
  }

  const isLocal = isLoopbackHost(parsed.host);
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : isLocal
        ? "http"
        : "https";
  return `${proto}://${parsed.hostWithPort}`;
}

function configuredPublicOrigin(): string | null {
  if (process.env.VERCEL_ENV === "preview") {
    return (
      originFromEnvHost("VERCEL_BRANCH_URL") ??
      originFromEnvHost("VERCEL_URL") ??
      originFromExplicitAppUrl()
    );
  }

  return (
    originFromExplicitAppUrl() ??
    originFromEnvHost("VERCEL_PROJECT_PRODUCTION_URL") ??
    originFromEnvHost("VERCEL_URL")
  );
}

function originFromExplicitAppUrl(): string | null {
  for (const key of ["NEXT_PUBLIC_APP_URL", "APP_URL"] as const) {
    const origin = originFromUrlEnv(key);
    if (origin) {
      return origin;
    }
  }
  return null;
}

function originFromUrlEnv(key: string): string | null {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    const host = normalizeHost(url.host);
    if (!host || !isAllowedHost(host)) {
      return null;
    }
    const port = url.port;
    const hostWithPort = port ? `${host}:${port}` : host;
    return `${url.protocol}//${hostWithPort}`;
  } catch {
    return null;
  }
}

function originFromEnvHost(key: string): string | null {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return null;
  }

  if (raw.includes("://")) {
    return originFromUrlEnv(key);
  }

  const parsed = parseHostHeader(raw);
  if (!parsed || !isAllowedHost(parsed.host)) {
    return null;
  }
  return `https://${parsed.hostWithPort}`;
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

  for (const key of [
    "VERCEL_BRANCH_URL",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ] as const) {
    const host = normalizeHost(process.env[key] ?? null);
    if (host) {
      hosts.add(host);
    }
  }

  return hosts;
}

function parseHostHeader(
  raw: string | null,
): { host: string; hostWithPort: string } | null {
  if (!raw) {
    return null;
  }
  const primary = raw.split(",")[0]?.trim();
  if (!primary) {
    return null;
  }
  const portMatch = primary.match(/:(\d+)$/);
  const port = portMatch?.[1];
  const hostPart = port ? primary.slice(0, -(port.length + 1)) : primary;
  const host = hostPart.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return null;
  }
  if (port) {
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return null;
    }
  }
  const hostWithPort = port ? `${host}:${port}` : host;
  return { host, hostWithPort };
}

function normalizeHost(raw: string | null): string | null {
  return parseHostHeader(raw)?.host ?? null;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}

function isVercelAppHost(host: string): boolean {
  return host === "vercel.app" || host.endsWith(".vercel.app");
}

function isAllowedHost(host: string): boolean {
  if (isLoopbackHost(host)) {
    return true;
  }
  if (allowedHosts().has(host)) {
    return true;
  }
  return process.env.VERCEL === "1" && isVercelAppHost(host);
}
