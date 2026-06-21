// SupabaseConnector wires PowerSync to Supabase Auth + Postgres.
//
// - fetchCredentials: returns the PowerSync endpoint plus the current
//   Supabase access token. PowerSync sends the token on every sync
//   connection; the PowerSync Cloud instance verifies it against Supabase's
//   JWKS (configured via the "Use Supabase Auth" checkbox in the instance's
//   Client Auth panel). The token's `app_metadata.tenant_id` claim is what
//   the sync streams use to scope each device's data.
//
// - uploadData: drains PowerSync's local CRUD queue and applies each
//   change to Supabase via PostgREST. RLS enforces tenant scoping on the
//   way in (the user's JWT is the only credential). Fatal Postgres errors
//   (data exception, constraint violation, RLS denial) discard the whole
//   transaction so a single bad row can't permanently wedge the queue;
//   transient errors are re-thrown so PowerSync retries with backoff.
//   Pattern ported from PowerSync's official Supabase example.

import {
  type AbstractPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

// Postgres response codes we cannot recover from by retrying. Matching one
// of these means the bad write gets discarded from the queue so it can't
// block subsequent writes.
const FATAL_RESPONSE_CODES = [
  // Class 22 — Data Exception (type mismatch, range, etc.)
  /^22\d{3}$/,
  // Class 23 — Integrity Constraint Violation (NOT NULL, FOREIGN KEY, UNIQUE)
  /^23\d{3}$/,
  // INSUFFICIENT PRIVILEGE — typically an RLS denial.
  /^42501$/,
];

function isFatalError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return FATAL_RESPONSE_CODES.some((re) => re.test(code));
}

function isPrimaryKeyUniqueViolation(
  error: unknown,
  tableName: string
): boolean {
  if (!error || typeof error !== "object") return false;

  const postgresError = error as {
    code?: unknown;
    details?: unknown;
    message?: unknown;
  };
  if (postgresError.code !== "23505") return false;

  const details =
    typeof postgresError.details === "string" ? postgresError.details : "";
  const message =
    typeof postgresError.message === "string" ? postgresError.message : "";

  return (
    details.startsWith("Key (id)=") || message.includes(`"${tableName}_pkey"`)
  );
}

function decodeJwtPart<T>(token: string, index: number): T | null {
  try {
    const part = token.split(".")[index];
    if (!part) return null;

    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    return JSON.parse(atob(padded)) as T;
  } catch {
    return null;
  }
}

function readTenantIdFromAccessToken(token: string): string | null {
  try {
    const decoded = decodeJwtPart<{
      app_metadata?: { tenant_id?: unknown };
    }>(token, 1);
    if (!decoded) return null;
    const tenantId = decoded.app_metadata?.tenant_id;
    return typeof tenantId === "string" && tenantId ? tenantId : null;
  } catch {
    return null;
  }
}

function readJwtDebugInfo(token: string) {
  const header = decodeJwtPart<{ alg?: unknown; kid?: unknown }>(token, 0);
  const payload = decodeJwtPart<{ iss?: unknown; aud?: unknown }>(token, 1);

  return {
    algorithm: typeof header?.alg === "string" ? header.alg : undefined,
    keyId: typeof header?.kid === "string" ? header.kid : undefined,
    issuer: typeof payload?.iss === "string" ? payload.iss : undefined,
    audience:
      typeof payload?.aud === "string"
        ? payload.aud
        : Array.isArray(payload?.aud)
          ? payload.aud.join(",")
          : undefined,
  };
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "(invalid endpoint URL)";
  }
}

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
    let session = data.session;

    // Tenant bootstrap updates app_metadata server-side. The browser can still
    // hold the pre-bootstrap access token, so refresh once before PowerSync
    // evaluates sync rules that depend on app_metadata.tenant_id.
    let tenantId = readTenantIdFromAccessToken(session.access_token);
    if (!tenantId) {
      const refreshed = await this.supabase.auth.refreshSession();
      if (!refreshed.error && refreshed.data.session) {
        session = refreshed.data.session;
        tenantId = readTenantIdFromAccessToken(session.access_token);
      } else if (refreshed.error) {
        console.warn(
          "[PowerSync] Supabase session refresh failed",
          refreshed.error.message
        );
      }
    }

    const endpoint = getPublicEnv().powersyncUrl;
    console.info("[PowerSync] credentials", {
      endpointHost: endpointHost(endpoint),
      hasTenantClaim: Boolean(tenantId),
      jwt: readJwtDebugInfo(session.access_token),
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : undefined,
    });

    if (!tenantId) {
      console.warn(
        "[PowerSync] Supabase session is missing app_metadata.tenant_id"
      );
    }

    return {
      endpoint,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    let lastOp: CrudEntry | null = null;
    try {
      for (const op of transaction.crud) {
        lastOp = op;
        const table = this.supabase.from(op.table);
        let result;

        switch (op.op) {
          case UpdateType.PUT: {
            // Plain INSERT, not upsert. PostgREST upsert requires UPDATE
            // privilege on every column it might touch on conflict, and our
            // sales table revokes UPDATE on everything except the void
            // columns (see supabase/migrations/...rls_policies.sql).
            const record = { ...op.opData, id: op.id };
            result = await table.insert(record);
            // A primary-key 23505 means this exact row is already on the
            // server, usually because a previous upload committed this op
            // before a later op failed transiently. Treat only that case as
            // idempotent; business unique constraints such as
            // refunds(original_sale_id) should still surface as fatal upload
            // errors instead of silently clearing the queue.
            if (isPrimaryKeyUniqueViolation(result.error, op.table)) {
              console.info(
                "[PowerSync] PUT row already on server, treating as success",
                { table: op.table, id: op.id }
              );
              continue;
            }
            break;
          }
          case UpdateType.PATCH: {
            result = await table.update(op.opData ?? {}).eq("id", op.id);
            break;
          }
          case UpdateType.DELETE: {
            result = await table.delete().eq("id", op.id);
            break;
          }
          default:
            continue;
        }

        if (result.error) {
          // Re-throw so the catch below decides discard-vs-retry.
          throw result.error;
        }
      }

      await transaction.complete();
    } catch (error) {
      if (isFatalError(error)) {
        console.error(
          "[PowerSync] fatal upload error — discarding transaction",
          { op: lastOp, error }
        );
        await transaction.complete();
      } else {
        // Transient (network, 5xx, lock contention, etc.) — re-throw so
        // PowerSync retries with backoff. The queue stays intact.
        throw error;
      }
    }
  }
}
