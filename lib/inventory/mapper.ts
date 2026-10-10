// No `import "server-only"` here: lib/products/repository.ts, which
// scripts/seed-qa.ts loads under plain tsx, maps the initial count it records
// with a product.
import { toIso } from "@/lib/dates";
import type { inventoryMovements } from "@/lib/db/schema";
import type { InventoryMovement } from "@/lib/inventory";

export function mapDbInventoryMovement(
  row: typeof inventoryMovements.$inferSelect
): InventoryMovement {
  return {
    id: row.id,
    tenantId: row.tenantId,
    productId: row.productId,
    userId: row.userId,
    delta: row.delta,
    reason: row.reason,
    note: row.note,
    createdAt: toIso(row.createdAt),
    clientCreatedAt: toIso(row.clientCreatedAt),
  };
}
