import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "qr_transfer",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(tenantUsers),
  products: many(products),
  sales: many(sales),
  refunds: many(refunds),
}));

export const tenantUsers = pgTable(
  "tenant_users",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index("tenant_users_user_id_idx").on(table.userId),
  ],
);

export const tenantUsersRelations = relations(tenantUsers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantUsers.tenantId],
    references: [tenants.id],
  }),
}));

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents"),
    category: text("category").notNull(),
    imagePath: text("image_path"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("products_tenant_id_idx").on(table.tenantId),
    index("products_tenant_archived_idx").on(table.tenantId, table.archivedAt),
  ],
);

export const productsRelations = relations(products, ({ one }) => ({
  tenant: one(tenants, {
    fields: [products.tenantId],
    references: [tenants.id],
  }),
}));

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    saleDiscountCents: integer("sale_discount_cents").notNull().default(0),
    saleDiscountReason: text("sale_discount_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientCreatedAt: timestamp("client_created_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index("sales_tenant_created_at_idx").on(table.tenantId, table.createdAt),
    index("sales_user_id_idx").on(table.userId),
  ],
);

export const salesRelations = relations(sales, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [sales.tenantId],
    references: [tenants.id],
  }),
  lines: many(saleLines),
  refunds: many(refunds),
}));

export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    productName: text("product_name").notNull(),
    category: text("category").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    unitCostCents: integer("unit_cost_cents"),
    lineDiscountCents: integer("line_discount_cents").notNull().default(0),
    lineDiscountReason: text("line_discount_reason"),
    lineTotalCents: integer("line_total_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sale_lines_sale_id_idx").on(table.saleId),
    index("sale_lines_tenant_id_idx").on(table.tenantId),
  ],
);

export const saleLinesRelations = relations(saleLines, ({ one }) => ({
  sale: one(sales, {
    fields: [saleLines.saleId],
    references: [sales.id],
  }),
  tenant: one(tenants, {
    fields: [saleLines.tenantId],
    references: [tenants.id],
  }),
  product: one(products, {
    fields: [saleLines.productId],
    references: [products.id],
  }),
}));

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    originalSaleId: uuid("original_sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientCreatedAt: timestamp("client_created_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("refunds_original_sale_id_unique").on(table.originalSaleId),
    index("refunds_tenant_created_at_idx").on(table.tenantId, table.createdAt),
  ],
);

export const refundsRelations = relations(refunds, ({ one }) => ({
  tenant: one(tenants, {
    fields: [refunds.tenantId],
    references: [tenants.id],
  }),
  originalSale: one(sales, {
    fields: [refunds.originalSaleId],
    references: [sales.id],
  }),
}));
