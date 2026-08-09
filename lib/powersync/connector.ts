// SupabaseConnector wires PowerSync to Supabase Auth + Postgres.
//
// - fetchCredentials: returns the PowerSync endpoint plus the current
//   Supabase access token. PowerSync sends the token on every sync
//   connection; the PowerSync Cloud instance verifies it against Supabase's
//   JWKS (configured via the "Use Supabase Auth" checkbox in the instance's
//   Client Auth panel). The token's `app_metadata.tenant_id` claim is what
//   the sync streams use to scope each device's data.
//
// - uploadData: drains PowerSync's local CRUD queue. Sale, void, and refund
//   transactions go through authenticated Postgres RPCs so the remote commit is
//   atomic. Other supported transactions contain exactly one row operation.
//   Permanent errors are copied into a local-only dead-letter table while the
//   transaction remains queued; all errors are re-thrown for PowerSync backoff.

import {
  type AbstractPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { reportPermanentSyncFailure } from "@/lib/observability/report-sync-failure";
import {
  recordSyncFailure,
  resolveSyncFailure,
} from "@/lib/powersync/sync-failures";
import {
  createUploadPlan,
  InvalidUploadTransactionError,
} from "@/lib/powersync/upload-plan";

// Postgres response codes we cannot recover from by retrying. Matching one
// stores the complete local transaction for explicit recovery. The transaction
// remains queued and blocks later writes until a retry succeeds.
const FATAL_RESPONSE_CODES = [
  // Class 22 — Data Exception (type mismatch, range, etc.)
  /^22\d{3}$/,
  // Class 23 — Integrity Constraint Violation (NOT NULL, FOREIGN KEY, UNIQUE)
  /^23\d{3}$/,
  // INSUFFICIENT PRIVILEGE — typically an RLS denial.
  /^42501$/,
];

function isFatalError(error: unknown): boolean {
  if (error instanceof InvalidUploadTransactionError) return true;
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
      const plan = createUploadPlan(transaction.crud);
      lastOp = transaction.crud.at(-1) ?? null;

      if (plan.kind === "create-sale") {
        const result = await this.supabase.rpc("powersync_create_sale", {
          sale_row: plan.sale,
          sale_line_rows: plan.lines,
        });
        if (result.error) throw result.error;
      } else if (plan.kind === "void-sale") {
        const result = await this.supabase.rpc("powersync_void_sale", {
          sale_id: plan.saleId,
          voided_by_user_id: plan.voidedByUserId,
        });
        if (result.error) throw result.error;
      } else if (plan.kind === "create-refund") {
        const result = await this.supabase.rpc("powersync_create_refund", {
          refund_row: plan.refund,
        });
        if (result.error) throw result.error;
      } else {
        await this.uploadSingleOperation(plan.operation);
      }

      await resolveSyncFailure(database, {
        transactionId: transaction.transactionId,
        operations: transaction.crud,
      });
      await transaction.complete();
    } catch (error) {
      if (isFatalError(error)) {
        console.error(
          "[PowerSync] permanent upload error — preserving for recovery",
          { op: lastOp, error }
        );
        // Try to capture the complete transaction for recovery. The CRUD
        // transaction remains queued even if this local write fails.
        try {
          await recordSyncFailure(database, {
            transactionId: transaction.transactionId,
            operations: transaction.crud,
            error,
          });
          reportPermanentSyncFailure({
            error,
            transactionId: transaction.transactionId,
            operations: transaction.crud,
          });
        } catch (recordingError) {
          console.error("[PowerSync] failed to record permanent upload error", {
            transactionId: transaction.transactionId,
            error: recordingError,
          });
        }
      }
      // Network/5xx failures are not dead-lettered, but all failures remain in
      // the CRUD queue and use PowerSync's retry/backoff behavior.
      throw error;
    }
  }

  private async uploadSingleOperation(op: CrudEntry): Promise<void> {
    const table = this.supabase.from(op.table);
    let result;

    switch (op.op) {
      case UpdateType.PUT: {
        const record = { ...op.opData, id: op.id };
        result = await table.insert(record);
        if (isPrimaryKeyUniqueViolation(result.error, op.table)) {
          console.info(
            "[PowerSync] PUT row already on server, treating as success",
            { table: op.table, id: op.id }
          );
          return;
        }
        break;
      }
      case UpdateType.PATCH:
        result = await table.update(op.opData ?? {}).eq("id", op.id);
        break;
      case UpdateType.DELETE:
        result = await table.delete().eq("id", op.id);
        break;
      default:
        return;
    }

    if (result.error) {
      throw result.error;
    }
  }
}
