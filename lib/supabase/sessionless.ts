import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

/**
 * A client that keeps any session it gets in memory, for this request only.
 * It never reads or writes the request's cookies, so checking a token with
 * it leaves the browser signed in (or out) exactly as it was.
 */
export function createSessionlessClient() {
  const env = getPublicEnv();

  return createSupabaseClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
