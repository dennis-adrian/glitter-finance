// Local-first sale write helpers. Mirror the business logic from
// lib/sales/repository.ts (normalize, snapshot price/cost, clamp
// discounts, compute line totals) but write to the per-device PowerSync
// SQLite store instead of Postgres. PowerSync's CRUD queue picks up the
// changes and uploads them to Supabase via SupabaseConnector.uploadData.
//
// The watch subscriptions in glitter-pos-app.tsx re-fire on every local
// write, so the UI updates instantly from local state — no waiting on
// the network, no separate "optimistic update" code path.

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { clampDiscount } from "@/lib/money";
import type { PaymentMethod, Product } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

export type CreateSaleLocalLine = {
  product: Product;
  quantity: number;
  lineDiscountCents?: number;
  lineDiscountReason?: string;
};

export type CreateSaleLocalInput = {
  tenantId: string;
  userId: string;
  paymentMethod: PaymentMethod;
  saleDiscountCents: number;
  saleDiscountReason?: string;
  lines: CreateSaleLocalLine[];
  assertCurrent?: () => void;
};

/**
 * Combine duplicate-product lines, then snapshot price/cost and compute
 * per-line totals. Mirrors `normalizeLines` in lib/sales/repository.ts.
 */
function normalizeAndPriceLines(
  tenantId: string,
  lines: CreateSaleLocalLine[]
) {
  if (lines.length === 0) {
    throw new Error("La venta necesita al menos un producto.");
  }

  const byProduct = new Map<string, CreateSaleLocalLine>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Las cantidades deben ser números enteros positivos.");
    }
    if (line.product.archivedAt) {
      throw new Error(
        "Uno o más productos están archivados y no se pueden vender."
      );
    }
    const existing = byProduct.get(line.product.id);
    if (existing) {
      existing.quantity += line.quantity;
      existing.lineDiscountCents =
        (existing.lineDiscountCents ?? 0) + (line.lineDiscountCents ?? 0);
    } else {
      byProduct.set(line.product.id, { ...line });
    }
  }

  const now = nowIso();
  return Array.from(byProduct.values()).map((line) => {
    const subtotal = line.product.priceCents * line.quantity;
    const discount = clampDiscount(line.lineDiscountCents ?? 0, subtotal);
    return {
      id: uuid(),
      tenant_id: tenantId,
      product_id: line.product.id,
      product_name: line.product.name,
      category: line.product.category,
      quantity: line.quantity,
      unit_price_cents: line.product.priceCents,
      unit_cost_cents: line.product.costCents,
      line_discount_cents: discount,
      line_discount_reason: line.lineDiscountReason?.trim() || null,
      line_total_cents: subtotal - discount,
      created_at: now,
    };
  });
}

export async function createSaleLocal(
  db: AbstractPowerSyncDatabase,
  input: CreateSaleLocalInput
): Promise<{ saleId: string }> {
  const lineRows = normalizeAndPriceLines(input.tenantId, input.lines);
  const subtotalAfterLineDiscounts = lineRows.reduce(
    (sum, row) => sum + row.line_total_cents,
    0
  );
  const saleDiscountCents = clampDiscount(
    input.saleDiscountCents,
    subtotalAfterLineDiscounts
  );

  const saleId = uuid();
  const now = nowIso();

  // PowerSync batches all ops within a writeTransaction into one CRUD
  // transaction, so uploadData processes the sale + its lines together.
  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    await tx.execute(
      `INSERT INTO sales
        (id, tenant_id, user_id, payment_method, sale_discount_cents,
         sale_discount_reason, created_at, client_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        saleId,
        input.tenantId,
        input.userId,
        input.paymentMethod,
        saleDiscountCents,
        input.saleDiscountReason?.trim() || null,
        now,
        now,
      ]
    );

    for (const row of lineRows) {
      input.assertCurrent?.();
      await tx.execute(
        `INSERT INTO sale_lines
          (id, sale_id, tenant_id, product_id, product_name, category,
           quantity, unit_price_cents, unit_cost_cents, line_discount_cents,
           line_discount_reason, line_total_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          saleId,
          row.tenant_id,
          row.product_id,
          row.product_name,
          row.category,
          row.quantity,
          row.unit_price_cents,
          row.unit_cost_cents,
          row.line_discount_cents,
          row.line_discount_reason,
          row.line_total_cents,
          row.created_at,
        ]
      );
    }
  });

  return { saleId };
}

const VOID_WINDOW_MINUTES = 10;

export type VoidSaleLocalInput = {
  saleId: string;
  userId: string;
  tenantId: string;
  assertCurrent?: () => void;
};

export async function voidSaleLocal(
  db: AbstractPowerSyncDatabase,
  input: VoidSaleLocalInput
): Promise<void> {
  // writeTransaction takes a global lock, so the SELECT pre-checks and
  // the UPDATE mutation execute atomically against the local SQLite
  // store. Without it, two simultaneous voids (e.g. a double-tap or two
  // tabs sharing the same PowerSync DB) could both pass the
  // `voided_at IS NULL` check before either UPDATE landed.
  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    const rows = await tx.getAll<{
      created_at: string;
      voided_at: string | null;
      tenant_id: string;
    }>(
      `SELECT created_at, voided_at, tenant_id FROM sales WHERE id = ? LIMIT 1`,
      [input.saleId]
    );
    const sale = rows[0];
    if (!sale || sale.tenant_id !== input.tenantId) {
      throw new Error("No se encontró la venta.");
    }
    if (sale.voided_at) {
      throw new Error("Esta venta ya fue anulada.");
    }

    const minutesSince =
      (Date.now() - new Date(sale.created_at).getTime()) / 60000;
    if (minutesSince > VOID_WINDOW_MINUTES) {
      throw new Error(
        `Las ventas solo se pueden anular dentro de los primeros ${VOID_WINDOW_MINUTES} minutos.`
      );
    }

    const existingRefund = await tx.getAll<{ id: string }>(
      `SELECT id FROM refunds WHERE original_sale_id = ? LIMIT 1`,
      [input.saleId]
    );
    if (existingRefund.length) {
      throw new Error("No se puede anular una venta reembolsada.");
    }

    input.assertCurrent?.();
    await tx.execute(
      `UPDATE sales SET voided_at = ?, voided_by_user_id = ?
       WHERE id = ? AND voided_at IS NULL`,
      [nowIso(), input.userId, input.saleId]
    );
  });
}

export type RefundSaleLocalInput = {
  saleId: string;
  userId: string;
  tenantId: string;
  reason?: string;
  assertCurrent?: () => void;
};

export async function refundSaleLocal(
  db: AbstractPowerSyncDatabase,
  input: RefundSaleLocalInput
): Promise<void> {
  // Atomic check + INSERT. Most important for refunds because the local
  // SQLite refunds mirror has no UNIQUE(original_sale_id) constraint
  // (only the Postgres source does). Two simultaneous refund attempts
  // without serialization would both pass the existence check, both
  // INSERT, and PowerSync's uploader would discard one server-side via
  // 23505 — leaving a phantom duplicate in local SQLite indefinitely.
  await db.writeTransaction(async (tx) => {
    input.assertCurrent?.();
    const saleRows = await tx.getAll<{
      voided_at: string | null;
      tenant_id: string;
    }>(`SELECT voided_at, tenant_id FROM sales WHERE id = ? LIMIT 1`, [
      input.saleId,
    ]);
    const sale = saleRows[0];
    if (!sale || sale.tenant_id !== input.tenantId) {
      throw new Error("No se encontró la venta.");
    }
    if (sale.voided_at) {
      throw new Error("No se puede reembolsar una venta anulada.");
    }

    const existingRefund = await tx.getAll<{ id: string }>(
      `SELECT id FROM refunds WHERE original_sale_id = ? LIMIT 1`,
      [input.saleId]
    );
    if (existingRefund.length) {
      throw new Error("Esta venta ya fue reembolsada.");
    }

    const now = nowIso();
    input.assertCurrent?.();
    await tx.execute(
      `INSERT INTO refunds
        (id, tenant_id, original_sale_id, user_id, reason, created_at, client_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        input.tenantId,
        input.saleId,
        input.userId,
        input.reason?.trim() || null,
        now,
        now,
      ]
    );
  });
}
