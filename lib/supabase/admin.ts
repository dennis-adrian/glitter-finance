import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

export function createAdminClient() {
  const env = getServerEnv();

  if (!env.supabaseSecretKey) {
    throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
  }

  return createSupabaseClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
