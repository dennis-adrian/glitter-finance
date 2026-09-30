import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// No Drizzle relations() are declared: queries use the core query builder
// (db.select / db.insert), never the relational db.query API.

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

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Backs the hand-written auth.users FK (ON DELETE SET NULL).
    index("tenants_created_by_user_id_idx").on(table.createdByUserId),
  ]
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("categories_tenant_id_idx").on(table.tenantId),
    uniqueIndex("categories_tenant_name_unique").on(
      table.tenantId,
      sql`lower(${table.name})`
    ),
    check(
      "categories_name_valid_check",
      sql`btrim(${table.name}) <> '' AND char_length(${table.name}) <= 40`
    ),
  ]
);

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
    // encryption existed (like any undecryptable link, the next generated
    // link replaces them).
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
    // Backs the hand-written auth.users FK (ON DELETE SET NULL).
    index("tenant_invitations_created_by_user_id_idx").on(
      table.createdByUserId
    ),
  ]
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
    // Its (tenant_id, user_id) index also serves tenant_id-only lookups and
    // the tenants FK, so there is no separate tenant_id index.
    unique("tenant_users_tenant_id_user_id_unique").on(
      table.tenantId,
      table.userId
    ),
    index("tenant_users_user_id_idx").on(table.userId),
  ]
);

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
    // When each column last changed, by the updated_at of the edit that
    // changed it: { "<column>": "<timestamptz>" }. Edits are last-write-wins
    // per column, so a late offline edit still applies to the columns no
    // newer edit touched. Only the products_keep_latest_edit trigger writes
    // it (supabase/manual/20260926130100_products_last_write_wins.sql); a
    // column missing from it last changed when the product was created.
    // Server-only: devices never read or send it, so the client schema has
    // no mirror (tests/schema-parity.test.ts).
    fieldUpdatedAt: jsonb("field_updated_at")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
  },
  (table) => [
    // Leading tenant_id also serves tenant_id-only lookups and the tenants FK.
    index("products_tenant_archived_idx").on(table.tenantId, table.archivedAt),
    // Target for the tenant-scoped composite FK on sale_lines.product_id.
    // (id) is already unique as the PK; this pair makes the composite FK legal.
    unique("products_id_tenant_id_unique").on(table.id, table.tenantId),
    // Sale lines copy name and category, and the sale RPC rejects blank ones,
    // so a blank product could never be sold through PowerSync.
    check("products_name_not_blank_check", sql`btrim(${table.name}) <> ''`),
    check(
      "products_category_not_blank_check",
      sql`btrim(${table.category}) <> ''`
    ),
    // PRODUCT_NAME_MAX_LENGTH and PRODUCT_CATEGORY_MAX_LENGTH in
    // lib/products.ts. PowerSync uploads product rows straight through
    // PostgREST, so the server actions are not the only writers.
    check("products_name_length_check", sql`char_length(${table.name}) <= 120`),
    check(
      "products_category_length_check",
      sql`char_length(${table.category}) <= 60`
    ),
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
    // Backs the hand-written auth.users FK (ON DELETE RESTRICT).
    index("inventory_movements_user_id_idx").on(table.userId),
    // No uniqueness on `initial`: two offline devices may each record one,
    // and the latest becomes the stock baseline (see computeStockByProduct).
    // An `initial` of 0 is legal: it starts tracking a product that already
    // has sales without counting those sales against the new stock.
    check(
      "inventory_movements_sign_discipline_check",
      sql`(
        (${table.reason} = 'initial' AND ${table.delta} >= 0)
        OR (${table.reason} = 'restock' AND ${table.delta} > 0)
        OR (${table.reason} IN ('loss', 'gift') AND ${table.delta} < 0)
        OR (${table.reason} = 'adjustment' AND ${table.delta} <> 0)
      )`
    ),
  ]
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
    // Backs the hand-written auth.users FK (ON DELETE RESTRICT). Partial
    // because almost every sale is never voided.
    index("sales_voided_by_user_id_idx")
      .on(table.voidedByUserId)
      .where(sql`${table.voidedByUserId} IS NOT NULL`),
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
    // with referencing lines never happens. NOT NULL because every writer sets
    // it, and a NULL would skip the MATCH SIMPLE composite FK check entirely.
    productId: uuid("product_id").notNull(),
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
    // Backs the composite products FK below (column order matches it).
    index("sale_lines_product_id_tenant_id_idx").on(
      table.productId,
      table.tenantId
    ),
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
    // The line checks mirror the validation in powersync_create_sale
    // (supabase/manual/20260808235900_powersync_atomic_financial_mutations.sql)
    // so the server-action path is held to the same invariants.
    check(
      "sale_lines_product_name_not_blank_check",
      sql`btrim(${table.productName}) <> ''`
    ),
    check(
      "sale_lines_category_not_blank_check",
      sql`btrim(${table.category}) <> ''`
    ),
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
      "sale_lines_discount_within_gross_check",
      sql`${table.lineDiscountCents} <= ${table.unitPriceCents}::bigint * ${table.quantity}`
    ),
    check(
      "sale_lines_total_cents_nonnegative_check",
      sql`${table.lineTotalCents} >= 0`
    ),
    check(
      "sale_lines_total_coherence_check",
      sql`${table.lineTotalCents}::bigint = ${table.unitPriceCents}::bigint * ${table.quantity} - ${table.lineDiscountCents}`
    ),
  ]
);

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
    // Backs the hand-written auth.users FK (ON DELETE RESTRICT).
    index("refunds_user_id_idx").on(table.userId),
    foreignKey({
      name: "refunds_original_sale_id_tenant_id_sales_id_tenant_id_fk",
      columns: [table.originalSaleId, table.tenantId],
      foreignColumns: [sales.id, sales.tenantId],
    }).onDelete("restrict"),
  ]
);
