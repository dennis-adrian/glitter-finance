// Local-first sale write helpers. Price the sale with the same rules as the
// server action (lib/sales/pricing.ts: merge lines, snapshot price and cost,
// clamp discounts, compute totals) but write to the per-device PowerSync
// SQLite store instead of Postgres. PowerSync's CRUD queue picks up the
// changes and uploads them to Supabase via SupabaseConnector.uploadData.
//
// The watch subscriptions in glitter-pos-app.tsx re-fire on every local
// write, so the UI updates instantly from local state — no waiting on
// the network, no separate "optimistic update" code path.

import type { AbstractPowerSyncDatabase } from "@powersync/web";
import { nowIso } from "@/lib/dates";
import {
  isWithinVoidWindow,
  REFUNDED_SALE_VOID_MESSAGE,
  SALE_ALREADY_REFUNDED_MESSAGE,
  SALE_ALREADY_VOIDED_MESSAGE,
  VOID_WINDOW_EXPIRED_MESSAGE,
  VOIDED_SALE_REFUND_MESSAGE,
} from "@/lib/sales";
import { priceSale } from "@/lib/sales/pricing";
import type { PaymentMethod, Product } from "@/lib/types";
import { normalizeNote } from "@/lib/validation";

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

export async function createSaleLocal(
  db: AbstractPowerSyncDatabase,
  input: CreateSaleLocalInput
): Promise<{ saleId: string; totalCents: number }> {
  // Priced before the transaction, so a sale Postgres would reject never
  // enters the upload queue.
  const sale = priceSale(
    {
      lines: input.lines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        lineDiscountCents: line.lineDiscountCents,
        lineDiscountReason: line.lineDiscountReason,
      })),
      saleDiscountCents: input.saleDiscountCents,
      saleDiscountReason: input.saleDiscountReason,
    },
    new Map(input.lines.map((line) => [line.product.id, line.product]))
  );

  const saleId = crypto.randomUUID();
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
        sale.saleDiscountCents,
        sale.saleDiscountReason,
        now,
        now,
      ]
    );

    for (const line of sale.lines) {
      input.assertCurrent?.();
      await tx.execute(
        `INSERT INTO sale_lines
          (id, sale_id, tenant_id, product_id, product_name, category,
           quantity, unit_price_cents, unit_cost_cents, line_discount_cents,
           line_discount_reason, line_total_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          saleId,
          input.tenantId,
          line.productId,
          line.productName,
          line.category,
          line.quantity,
          line.unitPriceCents,
          line.unitCostCents,
          line.lineDiscountCents,
          line.lineDiscountReason,
          line.lineTotalCents,
          now,
        ]
      );
    }
  });

  return { saleId, totalCents: sale.totalCents };
}

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
      throw new Error(SALE_ALREADY_VOIDED_MESSAGE);
    }

    // Check and stamp with the same instant: the server re-checks the window
    // against this voided_at, so they must agree.
    const now = Date.now();
    if (!isWithinVoidWindow(sale.created_at, now)) {
      throw new Error(VOID_WINDOW_EXPIRED_MESSAGE);
    }

    const existingRefund = await tx.getAll<{ id: string }>(
      `SELECT id FROM refunds WHERE original_sale_id = ? LIMIT 1`,
      [input.saleId]
    );
    if (existingRefund.length) {
      throw new Error(REFUNDED_SALE_VOID_MESSAGE);
    }

    input.assertCurrent?.();
    await tx.execute(
      `UPDATE sales SET voided_at = ?, voided_by_user_id = ?
       WHERE id = ? AND voided_at IS NULL`,
      [new Date(now).toISOString(), input.userId, input.saleId]
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
  const reason = normalizeNote(input.reason, "El motivo");

  // Atomic check + INSERT. Most important for refunds because the local
  // SQLite refunds mirror has no UNIQUE(original_sale_id) constraint
  // (only the Postgres source does). Two simultaneous refund attempts
  // without serialization would both pass the existence check and both
  // INSERT. The server keeps one: the refund RPC answers the second upload
  // with the first refund's id and the connector drops the local copy. Until
  // that upload, though, the device would count the sale as refunded twice.
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
      throw new Error(VOIDED_SALE_REFUND_MESSAGE);
    }

    const existingRefund = await tx.getAll<{ id: string }>(
      `SELECT id FROM refunds WHERE original_sale_id = ? LIMIT 1`,
      [input.saleId]
    );
    if (existingRefund.length) {
      throw new Error(SALE_ALREADY_REFUNDED_MESSAGE);
    }

    const now = nowIso();
    input.assertCurrent?.();
    await tx.execute(
      `INSERT INTO refunds
        (id, tenant_id, original_sale_id, user_id, reason, created_at, client_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        input.tenantId,
        input.saleId,
        input.userId,
        reason,
        now,
        now,
      ]
    );
  });
}
