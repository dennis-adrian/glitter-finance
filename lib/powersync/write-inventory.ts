// Local-first inventory movement writes. Append-only rows replicate via
// PowerSync's INSERT path — no upload-connector changes needed.

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  isValidMovementDelta,
  movementDeltaError,
  type InventoryMovementReason,
} from "@/lib/inventory";
import { normalizeNote } from "@/lib/validation";

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

export type AddInventoryMovementInput = {
  tenantId: string;
  userId: string;
  productId: string;
  delta: number;
  reason: InventoryMovementReason;
  note?: string;
  assertCurrent?: () => void;
};

export async function productHasInitialMovementLocal(
  db: AbstractPowerSyncDatabase,
  productId: string
): Promise<boolean> {
  const rows = await db.getAll<{ id: string }>(
    `SELECT id FROM inventory_movements
     WHERE product_id = ? AND reason = 'initial'
     LIMIT 1`,
    [productId]
  );
  return rows.length > 0;
}

export async function addInventoryMovement(
  db: AbstractPowerSyncDatabase,
  input: AddInventoryMovementInput
): Promise<{ movementId: string }> {
  // Checked here so a row Postgres would reject never enters the upload
  // queue. More than one `initial` per product is allowed: the latest one is
  // the stock baseline (see computeStockByProduct).
  if (!isValidMovementDelta(input.reason, input.delta)) {
    throw new Error(movementDeltaError(input.reason));
  }
  const note = normalizeNote(input.note, "La nota");

  const movementId = uuid();
  const now = nowIso();

  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    await tx.execute(
      `INSERT INTO inventory_movements
        (id, tenant_id, product_id, user_id, delta, reason, note,
         created_at, client_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        movementId,
        input.tenantId,
        input.productId,
        input.userId,
        input.delta,
        input.reason,
        note,
        now,
        now,
      ]
    );
  });

  return { movementId };
}
