type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** Empty when unset — local dev can omit PowerSync and use server actions only. */
  powersyncUrl: string;
};

type ServerEnv = PublicEnv & {
  supabaseSecretKey: string;
  invitationSecretKey: string;
};

/**
 * Every variable the server cannot work without. assertServerEnv checks them
 * all when a server instance starts (instrumentation.ts), so a misconfigured
 * deploy fails at once, /api/health included, rather than on the first
 * invitation, tenant switch or image cleanup.
 */
export const REQUIRED_SERVER_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "INVITATION_SECRET_KEY",
  "DATABASE_URL",
] as const;

function requireValue(name: string, value: string | undefined) {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Throws one error naming every required server variable that is unset. */
export function assertServerEnv(
  env: Record<string, string | undefined> = process.env
) {
  const missing = REQUIRED_SERVER_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

// `process.env.NEXT_PUBLIC_*` lookups below MUST use literal property names so
// Next.js inlines them into the browser bundle.

/** True when a PowerSync Cloud endpoint is configured (staging/prod). */
export function isPowerSyncConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POWERSYNC_URL?.trim());
}

export function getPublicEnv(): PublicEnv {
  return {
    supabaseUrl: requireValue(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL
    ),
    supabasePublishableKey: requireValue(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
    powersyncUrl: process.env.NEXT_PUBLIC_POWERSYNC_URL?.trim() ?? "",
  };
}

export function getServerEnv(): ServerEnv {
  return {
    ...getPublicEnv(),
    supabaseSecretKey: requireValue(
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY
    ),
    invitationSecretKey: requireValue(
      "INVITATION_SECRET_KEY",
      process.env.INVITATION_SECRET_KEY
    ),
  };
}

/** Also read by the pnpm db:* scripts, which load .env files themselves. */
export function getDatabaseUrl(): string {
  return requireValue("DATABASE_URL", process.env.DATABASE_URL);
}
