import "server-only";

import { and, asc, eq, gte, sql } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { toIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { inventoryMovements, products } from "@/lib/db/schema";
import {
  normalizeInventoryMovement,
  type InventoryMovement,
  type InventorySnapshot,
} from "@/lib/inventory";

function mapDbInventoryMovement(
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

type OpeningStockRow = {
  product_id: string;
  units: string | number;
  has_movements: boolean;
  baseline_id: string | null;
  baseline_created_at: Date | string | null;
};

/**
 * Stock per product from the movements, sales and refunds recorded before
 * `asOf`, summed in Postgres by the rules of computeStockByProduct: the
 * latest `initial` (by millisecond, then id) is the baseline, and other
 * movements, sales and refunds count from its millisecond on. Timestamps are
 * truncated to milliseconds, as Date.parse reads them on the device.
 */
async function loadOpeningStock(tenantId: string, asOf: Date) {
  const before = asOf.toISOString();
  const rows = await db.execute<OpeningStockRow>(sql`
    WITH baselines AS (
      SELECT DISTINCT ON (product_id)
        product_id,
        id,
        created_at,
        date_trunc('milliseconds', created_at) AS at_ms
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}
        AND reason = 'initial'
        AND created_at < ${before}
      ORDER BY product_id, date_trunc('milliseconds', created_at) DESC, id DESC
    ),
    counted AS (
      SELECT m.product_id, m.delta AS units, true AS is_movement
      FROM inventory_movements m
      LEFT JOIN baselines b ON b.product_id = m.product_id
      WHERE m.tenant_id = ${tenantId}
        AND m.created_at < ${before}
        AND (
          b.id IS NULL
          OR (m.reason = 'initial' AND m.id = b.id)
          OR (
            m.reason <> 'initial'
            AND date_trunc('milliseconds', m.created_at) >= b.at_ms
          )
        )
      UNION ALL
      SELECT l.product_id, -l.quantity, false
      FROM sales s
      JOIN sale_lines l ON l.sale_id = s.id AND l.tenant_id = s.tenant_id
      LEFT JOIN baselines b ON b.product_id = l.product_id
      WHERE s.tenant_id = ${tenantId}
        AND s.created_at < ${before}
        AND s.voided_at IS NULL
        AND (b.id IS NULL OR date_trunc('milliseconds', s.created_at) >= b.at_ms)
      UNION ALL
      SELECT l.product_id, l.quantity, false
      FROM refunds r
      JOIN sale_lines l
        ON l.sale_id = r.original_sale_id AND l.tenant_id = r.tenant_id
      LEFT JOIN baselines b ON b.product_id = l.product_id
      WHERE r.tenant_id = ${tenantId}
        AND r.created_at < ${before}
        AND (b.id IS NULL OR date_trunc('milliseconds', r.created_at) >= b.at_ms)
    )
    SELECT
      c.product_id,
      sum(c.units)::int8 AS units,
      bool_or(c.is_movement) AS has_movements,
      b.id AS baseline_id,
      b.created_at AS baseline_created_at
    FROM counted c
    LEFT JOIN baselines b ON b.product_id = c.product_id
    GROUP BY c.product_id, b.id, b.created_at
  `);

  return Array.from(rows);
}

/**
 * The tenant's stock for '/', without its whole ledger: the ledger before
 * `asOf` summed per product (see loadOpeningStock), and the movements from
 * `asOf` on as rows. computeStockByProduct adds those, and the sales from
 * `asOf` on, to the opening.
 */
export async function getInventorySnapshotForTenant(
  tenantId: string,
  asOf: Date
): Promise<InventorySnapshot> {
  const [openingRows, movementRows] = await Promise.all([
    loadOpeningStock(tenantId, asOf),
    db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          gte(inventoryMovements.createdAt, asOf)
        )
      )
      .orderBy(asc(inventoryMovements.createdAt), asc(inventoryMovements.id)),
  ]);

  return {
    opening: {
      asOf: asOf.toISOString(),
      levels: openingRows.map((row) => ({
        productId: row.product_id,
        units: Number(row.units),
        baseline:
          row.baseline_id && row.baseline_created_at
            ? {
                id: row.baseline_id,
                // A raw query returns Postgres' text form, not a Date.
                createdAt: new Date(row.baseline_created_at).toISOString(),
              }
            : null,
      })),
    },
    movements: movementRows.map(mapDbInventoryMovement),
    hasMovements:
      movementRows.length > 0 || openingRows.some((row) => row.has_movements),
  };
}

export type AddInventoryMovementForTenantInput = {
  tenantId: string;
  userId: string;
  productId: string;
  delta: number;
  reason: InventoryMovement["reason"];
  note?: string | null;
};

/**
 * Records a stock movement for one of the tenant's products: the server-action
 * counterpart of the PowerSync writer (lib/powersync/write-inventory.ts), with
 * the same checks. Throws UserFacingError for a movement or product the user
 * can fix.
 */
export async function addInventoryMovementForTenant(
  input: AddInventoryMovementForTenantInput
): Promise<InventoryMovement> {
  const movement = normalizeInventoryMovement(input);

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, input.tenantId),
        eq(products.id, input.productId)
      )
    )
    .limit(1);
  if (!product) {
    throw new UserFacingError("No se encontró el producto.");
  }

  const now = new Date();
  const [row] = await db
    .insert(inventoryMovements)
    .values({
      tenantId: input.tenantId,
      productId: product.id,
      userId: input.userId,
      ...movement,
      createdAt: now,
      clientCreatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("No se pudo registrar el movimiento de inventario.");
  }

  return mapDbInventoryMovement(row);
}
