// Local-first inventory movement writes. Append-only rows replicate via
// PowerSync's INSERT path — no upload-connector changes needed.

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import {
  validateInventoryMovement,
  type InventoryMovementReason,
} from "@/lib/inventory";

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
  validateInventoryMovement(input.delta, input.reason);

  const movementId = uuid();
  const now = nowIso();

  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    if (input.reason === "initial") {
      const existing = await tx.getAll<{ id: string }>(
        `SELECT id FROM inventory_movements
         WHERE product_id = ? AND reason = 'initial'
         LIMIT 1`,
        [input.productId]
      );
      if (existing.length > 0) {
        throw new Error("Este producto ya tiene un stock inicial registrado.");
      }
    }

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
        input.note?.trim() || null,
        now,
        now,
      ]
    );
  });

  return { movementId };
}
