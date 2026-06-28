type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** Empty when unset — local dev can omit PowerSync and use server actions only. */
  powersyncUrl: string;
};

type ServerEnv = PublicEnv & {
  databaseUrl?: string;
  supabaseSecretKey?: string;
  invitationSecretKey?: string;
};

function requireValue(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
    databaseUrl: process.env.DATABASE_URL,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
    invitationSecretKey: process.env.INVITATION_SECRET_KEY,
  };
}
