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
    productId: line.productId ?? "",
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
  // `client_created_at` holds the time the record was created on the device, for
  // the offline-first model (see PRD §9). This online-only Stage A path has no
  // device timestamp to forward, so the server stamps it as a stand-in. When
  // PowerSync lands, the real client timestamp will be supplied here instead.
  const clientCreatedAt = new Date();

  return await db.transaction(async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        paymentMethod: input.paymentMethod,
        saleDiscountCents,
        saleDiscountReason: input.saleDiscountReason?.trim() || null,
        clientCreatedAt,
      })
      .returning();

    if (!sale) {
      throw new Error("No se pudo registrar la venta.");
    }

    const insertedLines = await tx
      .insert(saleLines)
      .values(lineValues.map((line) => ({ ...line, saleId: sale.id })))
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

export async function voidSaleForTenant(input: VoidSaleInput): Promise<Sale> {
  const [sale] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, input.tenantId), eq(sales.id, input.saleId)))
    .limit(1);

  if (!sale) {
    throw new Error("No se encontró la venta.");
  }

  if (sale.voidedAt) {
    throw new Error("Esta venta ya fue anulada.");
  }

  const minutesSinceSale =
    (Date.now() - new Date(sale.createdAt).getTime()) / 60000;

  if (minutesSinceSale > 10) {
    throw new Error(
      "Las ventas solo se pueden anular dentro de los primeros 10 minutos."
    );
  }

  const [existingRefund] = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.tenantId, input.tenantId),
        eq(refunds.originalSaleId, input.saleId)
      )
    )
    .limit(1);

  if (existingRefund) {
    throw new Error("No se puede anular una venta reembolsada.");
  }

  const [voidedSale] = await db
    .update(sales)
    .set({
      voidedAt: new Date(),
      voidedByUserId: input.userId,
    })
    .where(
      and(
        eq(sales.tenantId, input.tenantId),
        eq(sales.id, input.saleId),
        isNull(sales.voidedAt)
      )
    )
    .returning();

  if (!voidedSale) {
    throw new Error("No se pudo anular la venta.");
  }

  return getSaleForTenant(input.tenantId, input.saleId);
}

export async function refundSaleForTenant(
  input: RefundSaleInput
): Promise<Sale> {
  const original = await getSaleForTenant(input.tenantId, input.saleId);

  if (original.status === "voided") {
    throw new Error("No se puede reembolsar una venta anulada.");
  }

  if (original.refundOfSaleId) {
    throw new Error("No se puede reembolsar un registro de reembolso.");
  }

  const [existingRefund] = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.tenantId, input.tenantId),
        eq(refunds.originalSaleId, input.saleId)
      )
    )
    .limit(1);

  if (existingRefund) {
    throw new Error("Esta venta ya fue reembolsada.");
  }

  const [refund] = await db
    .insert(refunds)
    .values({
      tenantId: input.tenantId,
      originalSaleId: input.saleId,
      userId: input.userId,
      reason: input.reason?.trim() || null,
      // Server-stamped stand-in for the device creation time; see the note in
      // createSaleForTenant. PowerSync will supply the real client timestamp.
      clientCreatedAt: new Date(),
    })
    .returning();

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
