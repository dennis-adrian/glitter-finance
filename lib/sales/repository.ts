import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { UserFacingError } from "@/lib/action-result";
import { db } from "@/lib/db";
import {
  products,
  refunds,
  saleLines,
  sales,
  tenantUsers,
} from "@/lib/db/schema";
import { isWithinVoidWindow, VOID_WINDOW_EXPIRED_MESSAGE } from "@/lib/sales";
import {
  mergeSaleLines,
  priceSale,
  type SaleLineRequest,
} from "@/lib/sales/pricing";
import { canonicalizeCategory } from "@/lib/sample-data";
import type { PaymentMethod, Sale, SaleLine } from "@/lib/types";
import { normalizeNote } from "@/lib/validation";

export type CreateSaleLineInput = SaleLineRequest;

export type CreateSaleInput = {
  /** Chosen by the caller, so retrying a checkout records it only once. */
  saleId: string;
  tenantId: string;
  userId: string;
  userName: string;
  paymentMethod: PaymentMethod;
  saleDiscountCents: number;
  saleDiscountReason?: string | null;
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
    // Lines recorded before a category was renamed report under its current
    // name, like the PowerSync path (lib/powersync/sales-from-local.ts).
    category: canonicalizeCategory(line.category),
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
    throw new UserFacingError("No se encontró la venta.");
  }

  const [mappedSale] = await mapSaleRowsForTenant(tenantId, [sale]);

  if (!mappedSale) {
    throw new UserFacingError("No se encontró la venta.");
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

export async function createSaleForTenant(
  input: CreateSaleInput
): Promise<Sale> {
  // Checked before loading products, so a malformed line fails first.
  const requestedLines = mergeSaleLines(input.lines);
  const productIds = requestedLines.map((line) => line.productId);
  const productRows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenantId, input.tenantId),
        inArray(products.id, productIds)
      )
    );

  // Same pricing as the PowerSync writer (lib/powersync/write-sales.ts).
  const priced = priceSale(
    {
      lines: requestedLines,
      saleDiscountCents: input.saleDiscountCents,
      saleDiscountReason: input.saleDiscountReason,
    },
    new Map(productRows.map((product) => [product.id, product]))
  );
  // created_at is the business time: the clock of whoever recorded the sale.
  // PowerSync writes stamp the device clock into both created_at and
  // client_created_at; this server-action path has no device clock, so both
  // get the same app-server instant (PRD §9, "Timestamps").
  const createdAt = new Date();

  const recorded = await db.transaction(async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        id: input.saleId,
        tenantId: input.tenantId,
        userId: input.userId,
        paymentMethod: input.paymentMethod,
        saleDiscountCents: priced.saleDiscountCents,
        saleDiscountReason: priced.saleDiscountReason,
        createdAt,
        clientCreatedAt: createdAt,
      })
      .onConflictDoNothing({ target: sales.id })
      .returning();

    if (!sale) {
      // The id is taken: this is a retry of a checkout that was already
      // recorded, e.g. after its response was lost. The recorded sale is
      // returned below, once it has been checked to be this user's sale in
      // this tenant. The PowerSync RPC is retry-safe the same way.
      const [existing] = await tx
        .select({ tenantId: sales.tenantId, userId: sales.userId })
        .from(sales)
        .where(eq(sales.id, input.saleId))
        .limit(1);
      if (
        existing?.tenantId !== input.tenantId ||
        existing.userId !== input.userId
      ) {
        throw new Error("No se pudo registrar la venta: el id ya está en uso.");
      }
      return null;
    }

    const insertedLines = await tx
      .insert(saleLines)
      .values(
        priced.lines.map((line) => ({
          ...line,
          tenantId: input.tenantId,
          saleId: sale.id,
          createdAt,
        }))
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
    } satisfies Sale;
  });

  return recorded ?? getSaleForTenant(input.tenantId, input.saleId);
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
    throw new UserFacingError("No se encontró la venta.");
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
      throw new UserFacingError("Esta venta ya fue anulada.");
    }

    if (!isWithinVoidWindow(sale.createdAt, voidedAt.getTime())) {
      throw new UserFacingError(VOID_WINDOW_EXPIRED_MESSAGE);
    }

    if (sale.isRefunded) {
      throw new UserFacingError("No se puede anular una venta reembolsada.");
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
    throw new UserFacingError(
      "No se puede reembolsar un registro de reembolso."
    );
  }

  const reason = normalizeNote(input.reason, "El motivo");
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
        throw new UserFacingError("No se puede reembolsar una venta anulada.");
      }

      if (sale.isRefunded) {
        throw new UserFacingError("Esta venta ya fue reembolsada.");
      }

      const [inserted] = await tx
        .insert(refunds)
        .values({
          tenantId: input.tenantId,
          originalSaleId: input.saleId,
          userId: input.userId,
          reason,
          createdAt,
          clientCreatedAt: createdAt,
        })
        .returning();

      return inserted;
    });
  } catch (error) {
    if (isUniqueViolation(error, "refunds_original_sale_id_unique")) {
      throw new UserFacingError("Esta venta ya fue reembolsada.");
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
