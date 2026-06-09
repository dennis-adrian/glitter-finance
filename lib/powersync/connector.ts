// SupabaseConnector wires PowerSync to Supabase Auth + Postgres.
//
// - fetchCredentials: returns the PowerSync endpoint plus the current
//   Supabase access token. PowerSync sends the token on every sync
//   connection; the PowerSync Cloud instance verifies it against Supabase's
//   JWKS (configured via the "Use Supabase Auth" checkbox in the instance's
//   Client Auth panel). The token's `app_metadata.tenant_id` claim is what
//   the sync streams use to scope each device's data.
//
// - uploadData: a no-op for now. PR 2 only switches the read path to
//   PowerSync; writes still go through server actions, which hit Postgres
//   directly. PowerSync replicates those writes back to clients via the
//   sync stream. PR 3 will implement local-first writes by pushing the
//   PowerSync CRUD queue here.

import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

export class SupabaseConnector implements PowerSyncBackendConnector {
  constructor(private readonly supabase: SupabaseClient) {}

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      throw new Error(`Could not fetch Supabase session: ${error.message}`);
    }
    if (!data.session) {
      return null;
    }
    return {
      endpoint: getPublicEnv().powersyncUrl,
      token: data.session.access_token,
      expiresAt: data.session.expires_at
        ? new Date(data.session.expires_at * 1000)
        : undefined,
    };
  }

  async uploadData(_database: AbstractPowerSyncDatabase): Promise<void> {
    // No-op until PR 3 switches writes to local-first.
  }
}
