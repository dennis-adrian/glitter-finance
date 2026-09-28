// Local-first inventory movement writes. Append-only rows replicate via
// PowerSync's INSERT path — no upload-connector changes needed.

import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { nowIso } from "@/lib/dates";
import {
  normalizeInventoryMovement,
  type InitialMovementState,
  type InventoryMovementReason,
} from "@/lib/inventory";

export type AddInventoryMovementInput = {
  tenantId: string;
  userId: string;
  productId: string;
  delta: number;
  reason: InventoryMovementReason;
  note?: string;
  assertCurrent?: () => void;
};

/**
 * Whether the local store has an `initial` count for the product. It holds
 * this device's own writes from the start, but other devices' rows only once
 * the first sync has completed: until then, no row found is "unknown".
 */
export async function initialMovementStateLocal(
  db: Pick<AbstractPowerSyncDatabase, "getAll" | "currentStatus">,
  productId: string
): Promise<InitialMovementState> {
  const rows = await db.getAll<{ id: string }>(
    `SELECT id FROM inventory_movements
     WHERE product_id = ? AND reason = 'initial'
     LIMIT 1`,
    [productId]
  );
  if (rows.length > 0) {
    return "recorded";
  }
  return db.currentStatus?.hasSynced ? "none" : "unknown";
}

type PreparedInventoryMovement = {
  id: string;
  tenantId: string;
  productId: string;
  userId: string;
  delta: number;
  reason: InventoryMovementReason;
  note: string | null;
  createdAt: string;
};

/**
 * The row for a movement, checked so a row Postgres would reject never
 * enters the upload queue (normalizeInventoryMovement). More than one
 * `initial` per product is allowed: the latest one is the stock baseline (see
 * computeStockByProduct).
 */
export function prepareInventoryMovement(
  input: Omit<AddInventoryMovementInput, "assertCurrent">
): PreparedInventoryMovement {
  return {
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    productId: input.productId,
    userId: input.userId,
    ...normalizeInventoryMovement(input),
    createdAt: nowIso(),
  };
}

/** Inserts a prepared movement inside the caller's write transaction. */
export async function insertInventoryMovement(
  tx: Pick<Transaction, "execute">,
  movement: PreparedInventoryMovement
) {
  await tx.execute(
    `INSERT INTO inventory_movements
      (id, tenant_id, product_id, user_id, delta, reason, note,
       created_at, client_created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movement.id,
      movement.tenantId,
      movement.productId,
      movement.userId,
      movement.delta,
      movement.reason,
      movement.note,
      movement.createdAt,
      movement.createdAt,
    ]
  );
}

export async function addInventoryMovement(
  db: AbstractPowerSyncDatabase,
  input: AddInventoryMovementInput
): Promise<{ movementId: string }> {
  const movement = prepareInventoryMovement(input);

  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    await insertInventoryMovement(tx, movement);
  });

  return { movementId: movement.id };
}
