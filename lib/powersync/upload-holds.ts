// Uploads the server defers because the device clock was ahead.
//
// Postgres rejects a device timestamp more than 5 minutes ahead of its own
// clock with 55000 (check_upload_timestamp in
// supabase/manual/20260926120000_powersync_upload_convergence.sql). The
// uploader retries it, and the upload queue is first in, first out, so that
// transaction and everything recorded after it wait until the server clock
// reaches the stored timestamp minus 5 minutes. Correcting the device clock
// does not shorten the wait: the queued rows keep the time they were recorded
// with. It only keeps new rows from being held.
//
// The uploader keeps one row here for the transaction the server deferred, so
// the sync pill, the screens that wait for the queue and Diagnostics can say
// why nothing uploads and until when. It is not a sync failure: nothing needs
// recovering. A row only applies while its transaction is at the head of the
// queue, so one left behind by an upload that later went through is ignored.

import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";
import type { LocalRow, uploadHolds } from "@/lib/db/client-schema";
import { formatDateTimeLabelInBolivia } from "@/lib/dates";
import { errorDetails, syncFailureId } from "@/lib/powersync/crud-metadata";

type UploadHoldRow = LocalRow<typeof uploadHolds>;

/** The SQLSTATE Postgres raises for a device timestamp ahead of its clock. */
export const DEVICE_CLOCK_AHEAD_CODE = "55000";

/** How far ahead of the server clock a timestamp may be (the SQL's bound). */
export const SERVER_CLOCK_TOLERANCE_MS = 5 * 60_000;

// The device-stamped columns Postgres bounds, in the financial RPCs and in the
// products and inventory_movements triggers.
const BOUNDED_TIMESTAMP_COLUMNS = [
  "created_at",
  "client_created_at",
  "updated_at",
  "archived_at",
  "voided_at",
] as const;

export type UploadHold = {
  transactionId: number;
  /** When the server clock accepts every timestamp of the transaction. */
  heldUntil: string | null;
  errorMessage: string;
  /** When this device first saw the server defer the transaction. */
  createdAt: string;
};

/**
 * The instant from which the server accepts every bounded timestamp in the
 * operations: the latest of them minus the 5 minutes the server allows.
 */
export function uploadHeldUntil(
  operations: readonly Pick<CrudEntry, "opData">[]
): string | null {
  let latest = Number.NEGATIVE_INFINITY;
  for (const operation of operations) {
    for (const column of BOUNDED_TIMESTAMP_COLUMNS) {
      const value = operation.opData?.[column];
      if (typeof value !== "string") continue;
      const time = Date.parse(value);
      if (Number.isFinite(time) && time > latest) latest = time;
    }
  }
  return Number.isFinite(latest)
    ? new Date(latest - SERVER_CLOCK_TOLERANCE_MS).toISOString()
    : null;
}

/**
 * Records that the server deferred the transaction. PowerSync retries it every
 * few seconds; an existing row for it is kept as it is, so the first time it
 * was deferred is not overwritten.
 */
export async function recordUploadHold(
  db: AbstractPowerSyncDatabase,
  input: { transactionId: number; operations: CrudEntry[]; error: unknown }
): Promise<void> {
  const id = syncFailureId(input);
  await db.writeTransaction(async (tx) => {
    const existing = await tx.getOptional<Pick<UploadHoldRow, "id">>(
      `SELECT id FROM upload_holds WHERE id = ?`,
      [id]
    );
    if (existing) return;

    // Only the head of the queue can be held, so one row is enough.
    await tx.execute(`DELETE FROM upload_holds`);
    await tx.execute(
      `INSERT INTO upload_holds
        (id, transaction_id, held_until, error_message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        input.transactionId,
        uploadHeldUntil(input.operations),
        errorDetails(input.error).message,
        new Date().toISOString(),
      ]
    );
  });
}

/** The hold on the transaction at the head of the upload queue, if any. */
export async function getUploadHold(
  db: AbstractPowerSyncDatabase
): Promise<UploadHold | null> {
  const [row] = await db.getAll<UploadHoldRow>(
    `SELECT id, transaction_id, held_until, error_message, created_at
     FROM upload_holds
     WHERE transaction_id = (SELECT tx_id FROM ps_crud ORDER BY id LIMIT 1)
     LIMIT 1`
  );
  if (!row) return null;
  return {
    transactionId: row.transaction_id,
    heldUntil: row.held_until,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export function sameUploadHold(
  a: UploadHold | null,
  b: UploadHold | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.transactionId === b.transactionId &&
    a.heldUntil === b.heldUntil &&
    a.errorMessage === b.errorMessage &&
    a.createdAt === b.createdAt
  );
}

/**
 * Why the queue is not uploading, and until when. A device clock that now
 * reads earlier than the held time was corrected after the rows were
 * recorded; otherwise it is still ahead of the server's.
 */
export function describeUploadHold(
  hold: Pick<UploadHold, "heldUntil">,
  now = Date.now()
): string {
  const heldUntil = hold.heldUntil ? Date.parse(hold.heldUntil) : Number.NaN;
  if (hold.heldUntil && Number.isFinite(heldUntil) && heldUntil > now) {
    return `Se registraron operaciones con la hora del dispositivo adelantada. La nube las acepta desde el ${formatDateTimeLabelInBolivia(
      hold.heldUntil
    )}; hasta entonces, lo registrado después también espera.`;
  }
  return "La hora de este dispositivo está adelantada y la nube todavía no acepta sus operaciones. Activa la fecha y hora automáticas; lo ya registrado con la hora adelantada se subirá cuando la hora real la alcance.";
}
