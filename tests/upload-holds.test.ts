import assert from "node:assert/strict";
import test from "node:test";
import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  Transaction,
} from "@powersync/web";
import {
  describeUploadHold,
  getUploadHold,
  recordUploadHold,
  sameUploadHold,
  uploadHeldUntil,
} from "@/lib/powersync/upload-holds";

function operation(data: Record<string, unknown>, clientId = 1): CrudEntry {
  return {
    clientId,
    opData: data,
    toJSON: () => ({ op_id: clientId, data }),
  } as unknown as CrudEntry;
}

test("a hold lasts until the latest bounded timestamp is within 5 minutes", () => {
  assert.equal(
    uploadHeldUntil([
      operation({
        created_at: "2026-09-29T00:00:00.000Z",
        client_created_at: "2026-09-29T00:00:00.000Z",
      }),
      operation({ created_at: "2026-09-29T00:02:00.000Z" }, 2),
    ]),
    "2026-09-28T23:57:00.000Z"
  );
  // A void only carries voided_at; a product edit updated_at and archived_at.
  assert.equal(
    uploadHeldUntil([operation({ voided_at: "2026-09-29T00:10:00.000Z" })]),
    "2026-09-29T00:05:00.000Z"
  );
  assert.equal(
    uploadHeldUntil([
      operation({
        updated_at: "2026-09-29T01:00:00.000Z",
        archived_at: "2026-09-29T02:00:00.000Z",
      }),
    ]),
    "2026-09-29T01:55:00.000Z"
  );
});

test("a hold without a readable timestamp has no end time", () => {
  assert.equal(uploadHeldUntil([operation({ name: "Mate" })]), null);
  assert.equal(
    uploadHeldUntil([operation({ created_at: "not a date", price: 10 })]),
    null
  );
});

test("the explanation depends on whether the device clock was corrected", () => {
  const now = Date.parse("2026-09-28T12:00:00.000Z");
  // The device clock now reads earlier than the held time: it was corrected.
  const corrected = describeUploadHold(
    { heldUntil: "2026-09-28T23:55:00.000Z" },
    now
  );
  assert.match(corrected, /con la hora del dispositivo adelantada/);
  assert.match(corrected, /La nube las acepta desde el 28 sept 2026/);
  // It still reads later than the held time: it is still ahead.
  const stillAhead = describeUploadHold(
    { heldUntil: "2026-09-28T11:00:00.000Z" },
    now
  );
  assert.match(stillAhead, /La hora de este dispositivo está adelantada/);
  assert.match(stillAhead, /Activá la fecha y hora automáticas/);
  assert.equal(describeUploadHold({ heldUntil: null }, now), stillAhead);
});

function holdDb(rows: Map<string, Record<string, unknown>>) {
  const statements: string[] = [];
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        getOptional: async (_sql: string, params: unknown[]) =>
          rows.has(String(params[0])) ? { id: params[0] } : null,
        execute: async (sql: string, params: unknown[] = []) => {
          statements.push(sql);
          if (/DELETE FROM upload_holds/.test(sql)) rows.clear();
          if (/INSERT INTO upload_holds/.test(sql)) {
            const [id, transactionId, heldUntil, message, createdAt] = params;
            rows.set(String(id), {
              id,
              transaction_id: transactionId,
              held_until: heldUntil,
              error_message: message,
              created_at: createdAt,
            });
          }
          return { rowsAffected: 1 };
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, statements };
}

test("recording keeps the first sighting and replaces any other hold", async () => {
  const rows = new Map<string, Record<string, unknown>>([
    ["transaction:3", { id: "transaction:3", transaction_id: 3 }],
  ]);
  const { db, statements } = holdDb(rows);
  const input = {
    transactionId: 4,
    operations: [operation({ created_at: "2026-09-29T00:00:00.000Z" })],
    error: { code: "55000", message: "ahead of the server clock" },
  };

  await recordUploadHold(db, input);
  assert.deepEqual([...rows.keys()], ["transaction:4"]);
  assert.equal(
    rows.get("transaction:4")?.held_until,
    "2026-09-28T23:55:00.000Z"
  );
  assert.equal(
    rows.get("transaction:4")?.error_message,
    "ahead of the server clock"
  );

  // PowerSync retries every few seconds; the row is written once.
  statements.length = 0;
  await recordUploadHold(db, input);
  assert.deepEqual(statements, []);
});

test("only the hold on the head of the queue applies", async () => {
  const queries: string[] = [];
  const db = {
    getAll: async (sql: string) => {
      queries.push(sql);
      return [];
    },
  } as unknown as AbstractPowerSyncDatabase;

  assert.equal(await getUploadHold(db), null);
  assert.match(
    queries[0],
    /transaction_id = \(SELECT tx_id FROM ps_crud ORDER BY id LIMIT 1\)/
  );
});

test("holds compare by value", () => {
  const hold = {
    transactionId: 4,
    heldUntil: "2026-09-28T23:55:00.000Z",
    errorMessage: "ahead",
    createdAt: "2026-09-28T12:00:00.000Z",
  };
  assert.ok(sameUploadHold(null, null));
  assert.ok(sameUploadHold(hold, { ...hold }));
  assert.ok(!sameUploadHold(hold, null));
  assert.ok(!sameUploadHold(hold, { ...hold, transactionId: 5 }));
});
