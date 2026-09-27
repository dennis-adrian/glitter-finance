import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  products,
  refunds,
  saleLines,
  sales,
  tenantUsers,
} from "@/lib/db/schema";
import { clampDiscount } from "@/lib/money";
import { isWithinVoidWindow, VOID_WINDOW_EXPIRED_MESSAGE } from "@/lib/sales";
import type { PaymentMethod, Sale, SaleLine } from "@/lib/types";

export type CreateSaleLineInput = {
  productId: string;
  quantity: number;
  lineDiscountCents?: number;
  lineDiscountReason?: string;
};

export type CreateSaleInput = {
  tenantId: string;
  userId: string;
  userName: string;
  paymentMethod: PaymentMethod;
  saleDiscountCents: number;
  saleDiscountReason?: string;
  lines: CreateSaleLineInput[];
};

export type VoidSaleInput = {
  tenantId: string;
  userId: string;
  saleId: string;
};

export type RefundSaleInput = {
  tenantId: string;
  userId: string;
  userName: string;
  saleId: string;
  reason?: string;
};

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapSaleLine(line: typeof saleLines.$inferSelect): SaleLine {
  return {
    id: line.id,
    productId: line.productId,
    productName: line.productName,
    category: line.category,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    unitCostCents: line.unitCostCents,
    lineDiscountCents: line.lineDiscountCents,
    lineDiscountReason: line.lineDiscountReason ?? undefined,
    lineTotalCents: line.lineTotalCents,
  };
}

async function loadUserNamesForTenant(tenantId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];

  if (!uniqueUserIds.length) {
    return new Map<string, string>();
  }

  const rows = await db
    .select({
      userId: tenantUsers.userId,
      displayName: tenantUsers.displayName,
    })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        inArray(tenantUsers.userId, uniqueUserIds)
      )
    );

  return new Map(rows.map((user) => [user.userId, user.displayName]));
}

async function loadLinesBySaleId(tenantId: string, saleIds: string[]) {
  if (!saleIds.length) {
    return new Map<string, SaleLine[]>();
  }

  const lineRows = await db
    .select()
    .from(saleLines)
    .where(
      and(eq(saleLines.tenantId, tenantId), inArray(saleLines.saleId, saleIds))
    )
    .orderBy(asc(saleLines.createdAt));

  const linesBySaleId = new Map<string, SaleLine[]>();

  for (const line of lineRows) {
    const mappedLine = mapSaleLine(line);
    linesBySaleId.set(line.saleId, [
      ...(linesBySaleId.get(line.saleId) ?? []),
      mappedLine,
    ]);
  }

  return linesBySaleId;
}

async function mapSaleRowsForTenant(
  tenantId: string,
  saleRows: Array<typeof sales.$inferSelect>
) {
  const [linesBySaleId, userNameById] = await Promise.all([
    loadLinesBySaleId(
      tenantId,
      saleRows.map((sale) => sale.id)
    ),
    loadUserNamesForTenant(
      tenantId,
      saleRows.map((sale) => sale.userId)
    ),
  ]);

  return saleRows.map((sale): Sale => {
    const voidedAt = sale.voidedAt ? toIso(sale.voidedAt) : undefined;

    return {
      id: sale.id,
      tenantId: sale.tenantId,
      userId: sale.userId,
      userName: userNameById.get(sale.userId) ?? "Vendedor",
      createdAt: toIso(sale.createdAt),
      clientCreatedAt: toIso(sale.clientCreatedAt),
      paymentMethod: sale.paymentMethod,
      saleDiscountCents: sale.saleDiscountCents,
      saleDiscountReason: sale.saleDiscountReason ?? undefined,
      lines: linesBySaleId.get(sale.id) ?? [],
      status: voidedAt ? "voided" : "completed",
      voidedAt,
      voidedByUserId: sale.voidedByUserId ?? undefined,
    };
  });
}

async function getSaleForTenant(tenantId: string, saleId: string) {
  const [sale] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
    .limit(1);

  if (!sale) {
    throw new Error("No se encontró la venta.");
  }

  const [mappedSale] = await mapSaleRowsForTenant(tenantId, [sale]);

  if (!mappedSale) {
    throw new Error("No se encontró la venta.");
  }

  return mappedSale;
}

function mapRefundRows(
  refundRows: Array<typeof refunds.$inferSelect>,
  saleById: Map<string, Sale>,
  userNameById: Map<string, string>
) {
  return refundRows.flatMap((refund): Sale[] => {
    const original = saleById.get(refund.originalSaleId);

    if (!original) {
      return [];
    }

    return [
      {
        ...original,
        id: refund.id,
        userId: refund.userId,
        userName: userNameById.get(refund.userId) ?? "Vendedor",
        createdAt: toIso(refund.createdAt),
        clientCreatedAt: toIso(refund.clientCreatedAt),
        status: "refunded",
        refundOfSaleId: original.id,
        refundedAt: toIso(refund.createdAt),
        refundReason: refund.reason ?? undefined,
      },
    ];
  });
}

function normalizeLines(lines: CreateSaleLineInput[]) {
  const byProduct = new Map<string, CreateSaleLineInput>();

  for (const line of lines) {
    if (!line.productId) {
      throw new Error("Cada línea de venta necesita un producto.");
    }

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Las cantidades deben ser números enteros positivos.");
    }

    const existing = byProduct.get(line.productId);
    byProduct.set(line.productId, {
      productId: line.productId,
      quantity: (existing?.quantity ?? 0) + line.quantity,
      lineDiscountCents:
        (existing?.lineDiscountCents ?? 0) + (line.lineDiscountCents ?? 0),
      lineDiscountReason:
        line.lineDiscountReason ?? existing?.lineDiscountReason,
    });
  }

  return [...byProduct.values()];
}

export async function createSaleForTenant(
  input: CreateSaleInput
): Promise<Sale> {
  const normalizedLines = normalizeLines(input.lines);

  if (!normalizedLines.length) {
    throw new Error("La venta necesita al menos un producto.");
  }

  const productIds = normalizedLines.map((line) => line.productId);
  const productRows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenantId, input.tenantId),
        inArray(products.id, productIds)
      )
    );

  const productById = new Map(
    productRows.map((product) => [product.id, product])
  );

  if (productById.size !== productIds.length) {
    throw new Error("Uno o más productos ya no están disponibles.");
  }

  const lineValues = normalizedLines.map((line) => {
    const product = productById.get(line.productId);

    if (!product || product.archivedAt) {
      throw new Error(
        "Uno o más productos están archivados y no se pueden vender."
      );
    }

    const lineSubtotalCents = product.priceCents * line.quantity;
    const lineDiscountCents = clampDiscount(
      line.lineDiscountCents ?? 0,
      lineSubtotalCents
    );

    return {
      tenantId: input.tenantId,
      productId: product.id,
      productName: product.name,
      category: product.category,
      quantity: line.quantity,
      unitPriceCents: product.priceCents,
      unitCostCents: product.costCents,
      lineDiscountCents,
      lineDiscountReason: line.lineDiscountReason?.trim() || null,
      lineTotalCents: lineSubtotalCents - lineDiscountCents,
    };
  });

  const subtotalAfterLineDiscounts = lineValues.reduce(
    (total, line) => total + line.lineTotalCents,
    0
  );
  const saleDiscountCents = clampDiscount(
    input.saleDiscountCents,
    subtotalAfterLineDiscounts
  );
  // created_at is the business time: the clock of whoever recorded the sale.
  // PowerSync writes stamp the device clock into both created_at and
  // client_created_at; this server-action path has no device clock, so both
  // get the same app-server instant (PRD §9, "Timestamps").
  const createdAt = new Date();

  return await db.transaction(async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        paymentMethod: input.paymentMethod,
        saleDiscountCents,
        saleDiscountReason: input.saleDiscountReason?.trim() || null,
        createdAt,
        clientCreatedAt: createdAt,
      })
      .returning();

    if (!sale) {
      throw new Error("No se pudo registrar la venta.");
    }

    const insertedLines = await tx
      .insert(saleLines)
      .values(
        lineValues.map((line) => ({ ...line, saleId: sale.id, createdAt }))
      )
      .returning();

    const mappedLines = insertedLines.map(mapSaleLine);

    return {
      id: sale.id,
      tenantId: sale.tenantId,
      userId: sale.userId,
      userName: input.userName,
      createdAt: toIso(sale.createdAt),
      clientCreatedAt: toIso(sale.clientCreatedAt),
      paymentMethod: sale.paymentMethod,
      saleDiscountCents: sale.saleDiscountCents,
      saleDiscountReason: sale.saleDiscountReason ?? undefined,
      lines: mappedLines,
      status: sale.voidedAt ? "voided" : "completed",
      voidedAt: sale.voidedAt ? toIso(sale.voidedAt) : undefined,
      voidedByUserId: sale.voidedByUserId ?? undefined,
    };
  });
}

export async function getSalesForTenant(tenantId: string): Promise<Sale[]> {
  const saleRows = await db
    .select()
    .from(sales)
    .where(eq(sales.tenantId, tenantId))
    .orderBy(desc(sales.createdAt));

  if (!saleRows.length) {
    return [];
  }

  const refundRows = await db
    .select()
    .from(refunds)
    .where(eq(refunds.tenantId, tenantId))
    .orderBy(desc(refunds.createdAt));

  const [mappedSales, refundUserNameById] = await Promise.all([
    mapSaleRowsForTenant(tenantId, saleRows),
    loadUserNamesForTenant(
      tenantId,
      refundRows.map((refund) => refund.userId)
    ),
  ]);

  const saleById = new Map(mappedSales.map((sale) => [sale.id, sale]));
  const mappedRefunds = mapRefundRows(refundRows, saleById, refundUserNameById);

  return [...mappedSales, ...mappedRefunds].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

type SalesTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A void and a refund of the same sale must never both commit, whichever path
// (server action or PowerSync RPC) writes them. Both lock the sale row first,
// so they run one after the other and the second sees the first; Postgres
// triggers enforce the same rules for any other writer.
async function lockSaleForCorrection(
  tx: SalesTransaction,
  tenantId: string,
  saleId: string
) {
  const [sale] = await tx
    .select({ createdAt: sales.createdAt, voidedAt: sales.voidedAt })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
    .for("update")
    .limit(1);

  if (!sale) {
    throw new Error("No se encontró la venta.");
  }

  const [existingRefund] = await tx
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(eq(refunds.tenantId, tenantId), eq(refunds.originalSaleId, saleId))
    )
    .limit(1);

  return { ...sale, isRefunded: Boolean(existingRefund) };
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
  };
  if (candidate.code === "23505") {
    return candidate.constraint_name === constraintName;
  }
  // Drizzle wraps the postgres.js error in `cause`.
  return isUniqueViolation(candidate.cause, constraintName);
}

export async function voidSaleForTenant(input: VoidSaleInput): Promise<Sale> {
  const voidedAt = new Date();

  await db.transaction(async (tx) => {
    const sale = await lockSaleForCorrection(tx, input.tenantId, input.saleId);

    if (sale.voidedAt) {
      throw new Error("Esta venta ya fue anulada.");
    }

    if (!isWithinVoidWindow(sale.createdAt, voidedAt.getTime())) {
      throw new Error(VOID_WINDOW_EXPIRED_MESSAGE);
    }

    if (sale.isRefunded) {
      throw new Error("No se puede anular una venta reembolsada.");
    }

    const [voidedSale] = await tx
      .update(sales)
      .set({
        voidedAt,
        voidedByUserId: input.userId,
      })
      .where(
        and(
          eq(sales.tenantId, input.tenantId),
          eq(sales.id, input.saleId),
          isNull(sales.voidedAt)
        )
      )
      .returning({ id: sales.id });

    if (!voidedSale) {
      throw new Error("No se pudo anular la venta.");
    }
  });

  return getSaleForTenant(input.tenantId, input.saleId);
}

export async function refundSaleForTenant(
  input: RefundSaleInput
): Promise<Sale> {
  const original = await getSaleForTenant(input.tenantId, input.saleId);

  if (original.refundOfSaleId) {
    throw new Error("No se puede reembolsar un registro de reembolso.");
  }

  // Same business-time rule as createSaleForTenant.
  const createdAt = new Date();
  let refund: typeof refunds.$inferSelect | undefined;

  try {
    refund = await db.transaction(async (tx) => {
      const sale = await lockSaleForCorrection(
        tx,
        input.tenantId,
        input.saleId
      );

      if (sale.voidedAt) {
        throw new Error("No se puede reembolsar una venta anulada.");
      }

      if (sale.isRefunded) {
        throw new Error("Esta venta ya fue reembolsada.");
      }

      const [inserted] = await tx
        .insert(refunds)
        .values({
          tenantId: input.tenantId,
          originalSaleId: input.saleId,
          userId: input.userId,
          reason: input.reason?.trim() || null,
          createdAt,
          clientCreatedAt: createdAt,
        })
        .returning();

      return inserted;
    });
  } catch (error) {
    if (isUniqueViolation(error, "refunds_original_sale_id_unique")) {
      throw new Error("Esta venta ya fue reembolsada.");
    }
    throw error;
  }

  if (!refund) {
    throw new Error("No se pudo registrar el reembolso.");
  }

  const [mappedRefund] = mapRefundRows(
    [refund],
    new Map([[original.id, original]]),
    new Map([[input.userId, input.userName]])
  );

  if (!mappedRefund) {
    throw new Error("No se pudo registrar el reembolso.");
  }

  return mappedRefund;
}
