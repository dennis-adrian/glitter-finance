type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  powersyncUrl: string;
};

type ServerEnv = PublicEnv & {
  databaseUrl?: string;
  supabaseSecretKey?: string;
};

function requireValue(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// IMPORTANT: every NEXT_PUBLIC_* lookup below MUST use a literal
// `process.env.NEXT_PUBLIC_FOO` reference. Next.js inlines those statically at
// build time so they survive into the browser bundle; dynamic lookups like
// `process.env[name]` are invisible to the bundler and resolve to undefined
// on the client. Server-side both work because process.env is a real object
// in Node.
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
    powersyncUrl: requireValue(
      "NEXT_PUBLIC_POWERSYNC_URL",
      process.env.NEXT_PUBLIC_POWERSYNC_URL
    ),
  };
}

export function getServerEnv(): ServerEnv {
  return {
    ...getPublicEnv(),
    databaseUrl: process.env.DATABASE_URL,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  };
}
