import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(tenantUsers),
  invitations: many(tenantInvitations),
  products: many(products),
  sales: many(sales),
  refunds: many(refunds),
  inventoryMovements: many(inventoryMovements),
}));

export const tenantInvitations = pgTable(
  "tenant_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    // AES-GCM ciphertext of the raw bearer token for link re-display; lookup
    // uses the HMAC hash in `token`. Nullable for rows created before delivery
    // encryption existed (those links must be rotated to recover).
    tokenDeliveryCiphertext: text("token_delivery_ciphertext"),
    // Nullable so the hand-written auth.users FK can ON DELETE SET NULL (the
    // value is kept as an audit field); the app always sets it on insert.
    createdByUserId: uuid("created_by_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("tenant_invitations_token_unique").on(table.token),
    index("tenant_invitations_tenant_id_idx").on(table.tenantId),
  ]
);

export const tenantInvitationsRelations = relations(
  tenantInvitations,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantInvitations.tenantId],
      references: [tenants.id],
    }),
  })
);

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
    check(
      "products_price_cents_nonnegative_check",
      sql`${table.priceCents} >= 0`
    ),
    check(
      "products_cost_cents_nonnegative_check",
      sql`${table.costCents} IS NULL OR ${table.costCents} >= 0`
    ),
    check(
      "products_low_stock_threshold_nonnegative_check",
      sql`${table.lowStockThreshold} IS NULL OR ${table.lowStockThreshold} >= 0`
    ),
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
    uniqueIndex("inventory_movements_one_initial_per_product_idx")
      .on(table.tenantId, table.productId)
      .where(sql`${table.reason} = 'initial'`),
    check("inventory_movements_delta_nonzero_check", sql`${table.delta} <> 0`),
    check(
      "inventory_movements_sign_discipline_check",
      sql`(
        (${table.reason} IN ('initial', 'restock') AND ${table.delta} > 0)
        OR (${table.reason} IN ('loss', 'gift') AND ${table.delta} < 0)
        OR (${table.reason} = 'adjustment')
      )`
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
    check(
      "sales_discount_cents_nonnegative_check",
      sql`${table.saleDiscountCents} >= 0`
    ),
    check(
      "sales_void_coherence_check",
      sql`(
        (${table.voidedAt} IS NULL AND ${table.voidedByUserId} IS NULL)
        OR (${table.voidedAt} IS NOT NULL AND ${table.voidedByUserId} IS NOT NULL)
      )`
    ),
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
    check("sale_lines_quantity_positive_check", sql`${table.quantity} > 0`),
    check(
      "sale_lines_unit_price_cents_nonnegative_check",
      sql`${table.unitPriceCents} >= 0`
    ),
    check(
      "sale_lines_unit_cost_cents_nonnegative_check",
      sql`${table.unitCostCents} IS NULL OR ${table.unitCostCents} >= 0`
    ),
    check(
      "sale_lines_discount_cents_nonnegative_check",
      sql`${table.lineDiscountCents} >= 0`
    ),
    check(
      "sale_lines_total_cents_nonnegative_check",
      sql`${table.lineTotalCents} >= 0`
    ),
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
