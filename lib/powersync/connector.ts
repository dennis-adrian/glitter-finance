// SupabaseConnector wires PowerSync to Supabase Auth + Postgres.
//
// - fetchCredentials: returns the PowerSync endpoint plus the current
//   Supabase access token. PowerSync sends the token on every sync
//   connection; the PowerSync Cloud instance verifies it against Supabase's
//   JWKS (configured via the "Use Supabase Auth" checkbox in the instance's
//   Client Auth panel). The token's `app_metadata.tenant_id` claim is what
//   the sync streams use to scope each device's data, so a token whose claim
//   is not the tenant this device's local data belongs to is never handed
//   over (see lib/powersync/tenant-claim.ts).
//
// - uploadData: drains PowerSync's local CRUD queue. Sale, void, and refund
//   transactions go through authenticated Postgres RPCs so the remote commit is
//   atomic. Product and inventory transactions are uploaded row by row
//   through PostgREST, in queue order (a product saved with its initial
//   stock count is one transaction of two rows).
//   Permanent errors are copied into a local-only dead-letter table while the
//   transaction remains queued; all errors are re-thrown for PowerSync backoff.
//   A transaction the server will never accept is discarded from Diagnostics
//   (lib/powersync/discard-sync-failure.ts). A transaction the server defers
//   because the device clock was ahead is not a failure; it is recorded as a
//   local upload hold (lib/powersync/upload-holds.ts) and retried.
//   When a void or refund loses a cross-device conflict, the RPC applies
//   nothing and returns NULL; the local row is then reverted so the device
//   matches the server.

import {
  type AbstractPowerSyncDatabase,
  type CrudEntry,
  type CrudTransaction,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { unreferencedProductImagePaths } from "@/lib/product-image-config";
import { removeProductImageObjects } from "@/lib/product-images";
import { reportClientFailure } from "@/lib/observability/report-client-failure";
import {
  reportPermanentSyncFailure,
  reportUploadHeldByDeviceClock,
} from "@/lib/observability/report-sync-failure";
import { errorCode, uploadTablesLabel } from "@/lib/powersync/crud-metadata";
import {
  reconcileSyncFailures,
  recordSyncFailure,
  resolveSyncFailure,
} from "@/lib/powersync/sync-failures";
import {
  ActiveTenantChangedError,
  TenantClaimMismatchError,
} from "@/lib/powersync/tenant-claim";
import {
  DEVICE_CLOCK_AHEAD_CODE,
  recordUploadHold,
  uploadHeldUntil,
} from "@/lib/powersync/upload-holds";
import {
  createUploadPlan,
  InvalidUploadTransactionError,
  type UploadPlan,
} from "@/lib/powersync/upload-plan";

// The server does not have the RPC or column this build uploads to:
// PostgREST's schema cache lacks the function (PGRST202) or column (PGRST204),
// or Postgres lacks it (42883 undefined_function, 42703 undefined_column).
// Only applying the pending SQL fixes that, so it is surfaced like any other
// permanent failure instead of being retried silently forever.
const SERVER_SCHEMA_MISMATCH_CODES = [/^PGRST20[24]$/, /^42883$/, /^42703$/];

const FINANCIAL_RPC = {
  "create-sale": "powersync_create_sale",
  "void-sale": "powersync_void_sale",
  "create-refund": "powersync_create_refund",
} as const;

/**
 * A PostgREST UPDATE matched no row: RLS hid it (e.g. the user is no longer a
 * tenant member) or it does not exist. PostgREST reports that as success, so
 * without this the edit would be dropped silently and reverted at the next
 * checkpoint. Carries 42501 so it is classified like other RLS denials.
 *
 * A late product edit does not end up here: the last-write-wins trigger
 * keeps the stored value of each column a newer edit changed and applies the
 * rest, so the UPDATE still returns the row, the upload completes, and the
 * device receives the merged row at the next checkpoint.
 */
export class UnappliedUpdateError extends Error {
  readonly code = "42501";

  constructor(table: string) {
    super(
      `La actualización de ${table} no modificó ninguna fila: no existe o el usuario ya no tiene acceso.`
    );
    this.name = "UnappliedUpdateError";
  }
}

function uploadTargetFor(plan: UploadPlan): string {
  switch (plan.kind) {
    case "create-sale":
    case "void-sale":
    case "create-refund":
      return FINANCIAL_RPC[plan.kind];
    case "single-operation":
      return plan.operation.table;
    case "multi-operation":
      return uploadTablesLabel(plan.operations);
  }
}

// Postgres response codes we cannot recover from by retrying. Matching one
// stores the complete local transaction for explicit recovery. The transaction
// remains queued and blocks later writes until a retry succeeds or the user
// discards it.
//
// Anything else is retried with backoff. That includes 55000, which the server
// raises for a device timestamp more than 5 minutes in the future: the upload
// succeeds once the server clock catches up, and until then a local hold says
// why the queue waits (lib/powersync/upload-holds.ts).
const FATAL_RESPONSE_CODES = [
  // Class 22 — Data Exception (type mismatch, range, etc.)
  /^22\d{3}$/,
  // Class 23 — Integrity Constraint Violation (NOT NULL, FOREIGN KEY, UNIQUE)
  /^23\d{3}$/,
  // INSUFFICIENT PRIVILEGE — typically an RLS denial. A signed-out client
  // gets it too; uploadData treats that case as transient.
  /^42501$/,
  ...SERVER_SCHEMA_MISMATCH_CODES,
];

function isFatalError(error: unknown): boolean {
  if (error instanceof InvalidUploadTransactionError) return true;
  const code = errorCode(error);
  return code != null && FATAL_RESPONSE_CODES.some((re) => re.test(code));
}

function isServerSchemaMismatch(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code != null && SERVER_SCHEMA_MISMATCH_CODES.some((re) => re.test(code))
  );
}

/**
 * The error stored in the local failure marker. A schema mismatch gets a
 * message that says what to do; PostgREST's own text only names the missing
 * function or column.
 */
function failureMarkerError(error: unknown, target: string): unknown {
  if (!isServerSchemaMismatch(error)) return error;
  const detail =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  return {
    code: errorCode(error),
    message:
      `El servidor no reconoce ${target}. Falta aplicar el SQL pendiente en ` +
      `Supabase; después de aplicarlo, forzar la sincronización.` +
      (detail ? ` (${detail})` : ""),
  };
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

// PowerSync retries fetchCredentials every few seconds while it throws. A
// device left on the previous tenant would otherwise refresh its session on
// every retry until it reloads. "Forzar sincronización" checks again at once
// (recheckTenantClaim).
const CLAIM_REFRESH_INTERVAL_MS = 30_000;

// A deferred upload is reported once it has waited this long in this session.
// A clock a few minutes ahead holds each upload for a minute or two, and would
// otherwise send an event for every sale.
const HELD_UPLOAD_REPORT_AFTER_MS = 10 * 60_000;

export class SupabaseConnector implements PowerSyncBackendConnector {
  private lastClaimRefreshAt: number | null = null;
  // The last refresh returned a session that claims another tenant: the
  // account's active tenant changed on another device. Kept until a token
  // claims this device's tenant again, so the retries in between (not due for
  // a refresh, or offline) keep reporting it.
  private activeTenantChanged = false;
  // The transaction the server is deferring, and since when, by the monotonic
  // clock: the device clock may be corrected while the upload waits.
  private heldUpload: { transactionId?: number; since: number } | null = null;

  /**
   * `expectedTenantId` is the tenant the local database belongs to. Null
   * when the user has no active tenant: the sync streams then match no rows
   * whatever the claim says, so there is nothing to compare.
   */
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly expectedTenantId: string | null
  ) {}

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      console.error("[PowerSync] Supabase session fetch failed", error);
      throw new Error("No se pudo obtener la sesión.");
    }
    if (!data.session) {
      return null;
    }
    let session = data.session;

    // A bootstrap, switch or join updates app_metadata server-side, and the
    // browser can still hold an older, unexpired token. Refresh once before
    // PowerSync evaluates sync streams that depend on app_metadata.tenant_id.
    if (!this.claimsExpectedTenant(session.access_token)) {
      const now = Date.now();
      if (
        this.lastClaimRefreshAt !== null &&
        now - this.lastClaimRefreshAt < CLAIM_REFRESH_INTERVAL_MS
      ) {
        throw this.claimMismatchError();
      }
      this.lastClaimRefreshAt = now;
      const refreshed = await this.supabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) {
        console.warn(
          "[PowerSync] Supabase session refresh failed",
          refreshed.error?.message ?? "no session"
        );
        throw this.claimMismatchError();
      }
      session = refreshed.data.session;
      if (!this.claimsExpectedTenant(session.access_token)) {
        // A refreshed token carries the Auth server's current app_metadata,
        // so its claim is the account's active tenant now. A missing claim
        // is not a change to another tenant; it stays a plain mismatch.
        this.activeTenantChanged =
          readTenantIdFromAccessToken(session.access_token) !== null;
        console.warn(
          "[PowerSync] Supabase session claims another tenant than the local data"
        );
        throw this.claimMismatchError();
      }
    }

    this.activeTenantChanged = false;
    return {
      endpoint: getPublicEnv().powersyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    };
  }

  /**
   * Lets the next fetchCredentials refresh the session even if it refreshed
   * one moments ago. For a reconnect the user asked for, which should show
   * whether the active tenant is still another one.
   */
  recheckTenantClaim(): void {
    this.lastClaimRefreshAt = null;
  }

  private claimsExpectedTenant(accessToken: string): boolean {
    return (
      this.expectedTenantId === null ||
      readTenantIdFromAccessToken(accessToken) === this.expectedTenantId
    );
  }

  private claimMismatchError(): TenantClaimMismatchError {
    return this.activeTenantChanged
      ? new ActiveTenantChangedError()
      : new TenantClaimMismatchError();
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    let lastOp: CrudEntry | null = null;
    let target: string | undefined;
    try {
      lastOp = transaction.crud.at(-1) ?? null;
      const plan = createUploadPlan(transaction.crud);
      target = uploadTargetFor(plan);

      if (plan.kind === "create-sale") {
        const result = await this.supabase.rpc(FINANCIAL_RPC[plan.kind], {
          sale_row: plan.sale,
          sale_line_rows: plan.lines,
        });
        if (result.error) throw result.error;
      } else if (plan.kind === "void-sale") {
        const result = await this.supabase.rpc(FINANCIAL_RPC[plan.kind], {
          sale_id: plan.saleId,
          voided_by_user_id: plan.voidedByUserId,
          voided_at_value: plan.voidedAt,
        });
        if (result.error) throw result.error;
        if (result.data === null) {
          // Another device refunded the sale before this void arrived, so the
          // server kept it unvoided. Undo the local void; the refund arrives
          // with the next checkpoint.
          await database.writeTransaction(async (tx) => {
            // Bypass the managed view so the revert is not queued as a new
            // upload.
            await tx.execute(
              `UPDATE ps_data__sales
               SET data = json_remove(data, '$.voided_at', '$.voided_by_user_id')
               WHERE id = ?`,
              [plan.saleId]
            );
          });
        }
      } else if (plan.kind === "create-refund") {
        const result = await this.supabase.rpc(FINANCIAL_RPC[plan.kind], {
          refund_row: plan.refund,
        });
        if (result.error) throw result.error;
        if (result.data === null) {
          // The sale was voided before this refund arrived, and a voided sale
          // is never refunded. Drop the local refund; the void arrives with
          // the next checkpoint.
          await database.writeTransaction(async (tx) => {
            await tx.execute(`DELETE FROM ps_data__refunds WHERE id = ?`, [
              plan.refund.id,
            ]);
          });
        } else if (typeof result.data !== "string") {
          throw new Error("The refund RPC did not return a canonical ID.");
        } else if (result.data !== plan.refund.id) {
          await database.writeTransaction(async (tx) => {
            // Bypass the managed view so reconciliation does not enqueue a
            // second mutation for a row that only ever existed locally.
            await tx.execute(
              `UPDATE OR IGNORE ps_data__refunds
               SET id = ?
               WHERE id = ?`,
              [result.data, plan.refund.id]
            );
            await tx.execute(`DELETE FROM ps_data__refunds WHERE id = ?`, [
              plan.refund.id,
            ]);
          });
        }
      } else if (plan.kind === "multi-operation") {
        for (const operation of plan.operations) {
          await this.uploadSingleOperation(operation);
        }
      } else {
        await this.uploadSingleOperation(plan.operation);
      }

      await transaction.complete();
      try {
        await resolveSyncFailure(database, {
          transactionId: transaction.transactionId,
          operations: transaction.crud,
        });
      } catch (resolutionError) {
        console.error("[PowerSync] failed to resolve sync failure marker", {
          transactionId: transaction.transactionId,
          error: resolutionError,
        });
      }
      try {
        // A prior local marker write can fail after complete(). Compare the
        // remaining markers against the actual queue so that a committed,
        // completed transaction never leaves the device permanently blocked.
        await reconcileSyncFailures(database);
      } catch (reconciliationError) {
        console.error("[PowerSync] failed to reconcile sync failure markers", {
          error: reconciliationError,
        });
      }
    } catch (error) {
      if (isFatalError(error) && !(await this.isSignedOutDenial(error))) {
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
            error: failureMarkerError(error, target ?? "la operación"),
          });
        } catch (recordingError) {
          console.error("[PowerSync] failed to record permanent upload error", {
            transactionId: transaction.transactionId,
            error: recordingError,
          });
          // Without the marker the device is not shown as blocked, although
          // the transaction still is.
          reportClientFailure("powersync_sync_failure_record", recordingError);
        }
        try {
          reportPermanentSyncFailure({
            error,
            transactionId: transaction.transactionId,
            operations: transaction.crud,
            target,
          });
        } catch (reportingError) {
          console.error("[PowerSync] failed to report permanent upload error", {
            transactionId: transaction.transactionId,
            error: reportingError,
          });
        }
      } else if (errorCode(error) === DEVICE_CLOCK_AHEAD_CODE) {
        await this.holdForDeviceClock(database, transaction, error, target);
      }
      // Network/5xx failures are not dead-lettered, but all failures remain in
      // the CRUD queue and use PowerSync's retry/backoff behavior.
      throw error;
    }
  }

  /**
   * The server deferred the transaction because one of its timestamps is
   * more than 5 minutes ahead of the server clock. It stays queued and is
   * retried, and holds every later upload until the server clock catches up,
   * so the hold is recorded for the screens, and reported once it has lasted.
   * Neither step may keep the error from reaching PowerSync.
   */
  private async holdForDeviceClock(
    database: AbstractPowerSyncDatabase,
    transaction: CrudTransaction,
    error: unknown,
    target: string | undefined
  ): Promise<void> {
    const now = performance.now();
    const held =
      this.heldUpload &&
      this.heldUpload.transactionId === transaction.transactionId
        ? this.heldUpload
        : { transactionId: transaction.transactionId, since: now };
    this.heldUpload = held;

    if (transaction.transactionId != null) {
      try {
        await recordUploadHold(database, {
          transactionId: transaction.transactionId,
          operations: transaction.crud,
          error,
        });
      } catch (recordingError) {
        console.error("[PowerSync] failed to record the upload hold", {
          transactionId: transaction.transactionId,
          error: recordingError,
        });
      }
    }
    if (now - held.since < HELD_UPLOAD_REPORT_AFTER_MS) return;
    try {
      reportUploadHeldByDeviceClock({
        transactionId: transaction.transactionId,
        operations: transaction.crud,
        target,
        heldUntil: uploadHeldUntil(transaction.crud),
      });
    } catch (reportingError) {
      console.error("[PowerSync] failed to report the upload hold", {
        transactionId: transaction.transactionId,
        error: reportingError,
      });
    }
  }

  /**
   * A 42501 from a client without a usable session is not an RLS decision:
   * supabase-js sent the request with the anon key (refresh token revoked,
   * signed out in another tab). getSession() refreshes an expired token when
   * it can; if no session comes back, the upload is retried after the user
   * signs in again instead of being recorded as a permanent failure.
   */
  private async isSignedOutDenial(error: unknown): Promise<boolean> {
    if (errorCode(error) !== "42501") return false;
    try {
      const { data, error: sessionError } =
        await this.supabase.auth.getSession();
      return Boolean(sessionError) || !data.session;
    } catch (sessionError) {
      console.warn("[PowerSync] session check after 42501 failed", {
        error: sessionError,
      });
      return true;
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
      case UpdateType.PATCH: {
        if (op.table === "products" && op.opData && "image_path" in op.opData) {
          await this.uploadProductImagePatch(op);
          return;
        }
        const patch = await table
          .update(op.opData ?? {})
          .eq("id", op.id)
          .select("id");
        if (patch.error) throw patch.error;
        if (!patch.data?.length) throw new UnappliedUpdateError(op.table);
        return;
      }
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

  /**
   * A products PATCH that changes image_path. Once Postgres has applied it,
   * the uploaded image it replaced is deleted from Storage. When a newer image
   * from another device wins instead (last-write-wins), the image this device
   * uploaded is the one nothing references, so that one is deleted. A
   * placeholder tone never deletes an image. Removal is best-effort and never
   * fails the upload.
   */
  private async uploadProductImagePatch(op: CrudEntry): Promise<void> {
    const data = op.opData ?? {};
    const before = await this.supabase
      .from("products")
      .select("tenant_id, image_path")
      .eq("id", op.id)
      .maybeSingle();
    if (before.error) throw before.error;

    const patch = await this.supabase
      .from("products")
      .update(data)
      .eq("id", op.id)
      .select("image_path");
    if (patch.error) throw patch.error;
    const stored = patch.data?.[0];
    if (!stored) throw new UnappliedUpdateError(op.table);
    if (!before.data) return;

    await removeProductImageObjects(
      this.supabase,
      unreferencedProductImagePaths({
        tenantId: before.data.tenant_id,
        productId: op.id,
        requestedPath:
          typeof data.image_path === "string" ? data.image_path : null,
        previousPath: before.data.image_path,
        storedPath: stored.image_path,
      })
    );
  }
}
