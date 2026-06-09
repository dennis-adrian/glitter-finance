// Builds the in-memory Sale[] shape (used throughout the UI and reports)
// from the three raw row sets that PowerSync replicates into the local
// SQLite store: sales, sale_lines, refunds.
//
// Mirrors the server-side reconstruction in lib/sales/repository.ts
// (mapSaleRowsForTenant + mapRefundRows). Kept as a pure function so it can
// be called from a watch handler without React glue.
//
// Limitation: tenant_users is NOT currently synced to the device (its
// composite PK doesn't fit PowerSync's `id`-column requirement). User
// display names must be resolved by the caller, typically using the current
// session's user as the only known mapping — sales rung up by other tenant
// members fall back to a generic label until tenant_users sync lands.

import type { PaymentMethod, Sale, SaleLine } from "@/lib/types";

export type LocalSaleRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  payment_method: string;
  sale_discount_cents: number;
  sale_discount_reason: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  created_at: string;
  client_created_at: string;
};

export type LocalSaleLineRow = {
  id: string;
  sale_id: string;
  tenant_id: string;
  product_id: string | null;
  product_name: string;
  category: string;
  quantity: number;
  unit_price_cents: number;
  unit_cost_cents: number | null;
  line_discount_cents: number;
  line_discount_reason: string | null;
  line_total_cents: number;
  created_at: string;
};

export type LocalRefundRow = {
  id: string;
  tenant_id: string;
  original_sale_id: string;
  user_id: string;
  reason: string | null;
  created_at: string;
  client_created_at: string;
};

function mapLine(row: LocalSaleLineRow): SaleLine {
  return {
    id: row.id,
    productId: row.product_id ?? "",
    productName: row.product_name,
    category: row.category,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    unitCostCents: row.unit_cost_cents,
    lineDiscountCents: row.line_discount_cents,
    lineDiscountReason: row.line_discount_reason ?? undefined,
    lineTotalCents: row.line_total_cents,
  };
}

export function buildSalesFromLocal(
  saleRows: LocalSaleRow[],
  lineRows: LocalSaleLineRow[],
  refundRows: LocalRefundRow[],
  resolveUserName: (userId: string) => string
): Sale[] {
  const linesBySaleId = new Map<string, SaleLine[]>();
  for (const row of lineRows) {
    const line = mapLine(row);
    const existing = linesBySaleId.get(row.sale_id);
    if (existing) {
      existing.push(line);
    } else {
      linesBySaleId.set(row.sale_id, [line]);
    }
  }

  const saleById = new Map<string, Sale>();
  const completedSales: Sale[] = saleRows.map((row) => {
    const sale: Sale = {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      userName: resolveUserName(row.user_id),
      createdAt: row.created_at,
      clientCreatedAt: row.client_created_at,
      paymentMethod: row.payment_method as PaymentMethod,
      saleDiscountCents: row.sale_discount_cents,
      saleDiscountReason: row.sale_discount_reason ?? undefined,
      lines: linesBySaleId.get(row.id) ?? [],
      status: row.voided_at ? "voided" : "completed",
      voidedAt: row.voided_at ?? undefined,
      voidedByUserId: row.voided_by_user_id ?? undefined,
    };
    saleById.set(sale.id, sale);
    return sale;
  });

  const refundSales: Sale[] = refundRows.flatMap((row): Sale[] => {
    const original = saleById.get(row.original_sale_id);
    if (!original) return [];
    return [
      {
        ...original,
        id: row.id,
        userId: row.user_id,
        userName: resolveUserName(row.user_id),
        createdAt: row.created_at,
        clientCreatedAt: row.client_created_at,
        status: "refunded",
        refundOfSaleId: original.id,
        refundedAt: row.created_at,
        refundReason: row.reason ?? undefined,
      },
    ];
  });

  return [...completedSales, ...refundSales].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
