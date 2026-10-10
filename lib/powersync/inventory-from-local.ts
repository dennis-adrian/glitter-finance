// Maps the inventory_movements rows PowerSync replicates into the local
// SQLite store to the InventoryMovement shape stock is computed from.

import type { inventoryMovements, LocalRow } from "@/lib/db/client-schema";
import type {
  InventoryMovement,
  InventoryMovementReason,
} from "@/lib/inventory";

export type LocalInventoryMovementRow = LocalRow<typeof inventoryMovements>;

export function mapLocalInventoryMovementRow(
  row: LocalInventoryMovementRow
): InventoryMovement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    userId: row.user_id,
    delta: row.delta,
    // A Postgres enum (inventory_movement_reason), stored as text locally.
    reason: row.reason as InventoryMovementReason,
    note: row.note,
    createdAt: row.created_at,
    clientCreatedAt: row.client_created_at,
  };
}
