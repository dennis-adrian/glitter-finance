type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

type ServerEnv = PublicEnv & {
  databaseUrl?: string;
  supabaseSecretKey?: string;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getPublicEnv(): PublicEnv {
  return {
    supabaseUrl: getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey: getRequiredEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
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
