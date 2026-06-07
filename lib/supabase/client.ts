import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

type BrowserClient = ReturnType<typeof createBrowserClient>;

let browserClient: BrowserClient | undefined;

// Memoized so the React tree shares one GoTrueClient. Multiple instances would
// race on auth state and emit a console warning in development.
export function createClient(): BrowserClient {
  if (!browserClient) {
    const env = getPublicEnv();
    browserClient = createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
  }

  return browserClient;
}
