import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "qr_transfer",
]);

export const inventoryMovementReasonEnum = pgEnum("inventory_movement_reason", [
  "initial",
  "restock",
  "adjustment",
  "loss",
  "gift",
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
  inventoryMovements: many(inventoryMovements),
}));

export const tenantUsers = pgTable(
  "tenant_users",
  {
    // Single-column PK so PowerSync can replicate membership rows to devices.
    id: uuid("id").primaryKey().defaultRandom(),
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
    unique("tenant_users_tenant_id_user_id_unique").on(
      table.tenantId,
      table.userId
    ),
    index("tenant_users_user_id_idx").on(table.userId),
    index("tenant_users_tenant_id_idx").on(table.tenantId),
  ]
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
    tracksInventory: boolean("tracks_inventory").notNull().default(false),
    lowStockThreshold: integer("low_stock_threshold"),
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
    // Target for the tenant-scoped composite FK on sale_lines.product_id.
    // (id) is already unique as the PK; this pair makes the composite FK legal.
    unique("products_id_tenant_id_unique").on(table.id, table.tenantId),
  ]
);

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [products.tenantId],
    references: [tenants.id],
  }),
  inventoryMovements: many(inventoryMovements),
}));

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull(),
    userId: uuid("user_id").notNull(),
    delta: integer("delta").notNull(),
    reason: inventoryMovementReasonEnum("reason").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientCreatedAt: timestamp("client_created_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "inventory_movements_product_id_tenant_id_products_id_tenant_id_fk",
      columns: [table.productId, table.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete("restrict"),
    index("inventory_movements_tenant_product_idx").on(
      table.tenantId,
      table.productId
    ),
    index("inventory_movements_tenant_created_at_idx").on(
      table.tenantId,
      table.createdAt
    ),
  ]
);

export const inventoryMovementsRelations = relations(
  inventoryMovements,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [inventoryMovements.tenantId],
      references: [tenants.id],
    }),
    product: one(products, {
      fields: [inventoryMovements.productId],
      references: [products.id],
    }),
  })
);

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
    // Target for the tenant-scoped composite FKs on sale_lines and refunds.
    // (id) is already unique as the PK; this pair makes the composite FK legal.
    unique("sales_id_tenant_id_unique").on(table.id, table.tenantId),
  ]
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
    // FK to sales is composite (sale_id, tenant_id) — declared in the table
    // config below so a line cannot reference a sale in another tenant.
    saleId: uuid("sale_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    // FK to products is composite (product_id, tenant_id) — declared in the
    // table config below so a line cannot reference a product in another
    // tenant. ON DELETE RESTRICT (not SET NULL) because tenant_id is NOT NULL
    // and cannot be half-nulled; products are soft-deleted via archived_at in
    // practice, and sales/sale_lines are append-only, so a real product delete
    // with referencing lines never happens.
    productId: uuid("product_id"),
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
    foreignKey({
      name: "sale_lines_sale_id_tenant_id_sales_id_tenant_id_fk",
      columns: [table.saleId, table.tenantId],
      foreignColumns: [sales.id, sales.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "sale_lines_product_id_tenant_id_products_id_tenant_id_fk",
      columns: [table.productId, table.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete("restrict"),
  ]
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
    // FK to sales is composite (original_sale_id, tenant_id) — declared in the
    // table config below so a refund cannot reference a sale in another tenant.
    originalSaleId: uuid("original_sale_id").notNull(),
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
    foreignKey({
      name: "refunds_original_sale_id_tenant_id_sales_id_tenant_id_fk",
      columns: [table.originalSaleId, table.tenantId],
      foreignColumns: [sales.id, sales.tenantId],
    }).onDelete("restrict"),
  ]
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
