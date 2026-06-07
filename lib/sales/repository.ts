import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, saleLines, sales } from "@/lib/db/schema";
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

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeLines(lines: CreateSaleLineInput[]) {
  const byProduct = new Map<string, CreateSaleLineInput>();

  for (const line of lines) {
    if (!line.productId) {
      throw new Error("Every sale line needs a product.");
    }

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Sale line quantities must be positive whole numbers.");
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
    throw new Error("A sale needs at least one product.");
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
    throw new Error("One or more products are no longer available.");
  }

  const lineValues = normalizedLines.map((line) => {
    const product = productById.get(line.productId);

    if (!product || product.archivedAt) {
      throw new Error("One or more products are archived and cannot be sold.");
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
      throw new Error("Unable to create sale.");
    }

    const insertedLines = await tx
      .insert(saleLines)
      .values(lineValues.map((line) => ({ ...line, saleId: sale.id })))
      .returning();

    const mappedLines: SaleLine[] = insertedLines.map((line) => ({
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
    }));

    return {
      id: sale.id,
      tenantId: sale.tenantId,
      userId: sale.userId,
      userName: input.userName,
      createdAt: toIso(sale.createdAt),
      paymentMethod: sale.paymentMethod,
      saleDiscountCents: sale.saleDiscountCents,
      saleDiscountReason: sale.saleDiscountReason ?? undefined,
      lines: mappedLines,
      status: sale.voidedAt ? "voided" : "completed",
      voidedAt: sale.voidedAt ? toIso(sale.voidedAt) : undefined,
    };
  });
}
