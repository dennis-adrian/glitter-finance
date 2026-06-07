// SQLite mirror of the Postgres schema in lib/db/schema.ts, used as the local
// PowerSync store on each device. Server-side code keeps using the Postgres
// schema; the two files describe the same tables in different dialects, with
// PowerSync keeping their rows in sync (per the sync rules in
// powersync/sync-rules.yaml).
//
// PowerSync notes:
// - Every synced table needs a single text `id` primary key. UUIDs are stored
//   as text.
// - SQLite has no native uuid/timestamp/boolean/enum types. UUIDs and ISO
//   timestamps are stored as text; enums (e.g. payment_method) as text.
// - Nullability declared here is for client-side type ergonomics; PowerSync
//   itself does not enforce NOT NULL constraints (the server is the source of
//   truth).
//
// Not yet synced:
// - tenants — single row per tenant; not worth a sync bucket.
// - tenant_users — composite PK in Postgres, needs either an `id` column or a
//   projected one in the sync rules. Until then, user display names are loaded
//   server-side.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  costCents: integer("cost_cents"),
  category: text("category").notNull(),
  imagePath: text("image_path"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  paymentMethod: text("payment_method").notNull(),
  saleDiscountCents: integer("sale_discount_cents").notNull(),
  saleDiscountReason: text("sale_discount_reason"),
  voidedAt: text("voided_at"),
  voidedByUserId: text("voided_by_user_id"),
  createdAt: text("created_at").notNull(),
  clientCreatedAt: text("client_created_at").notNull(),
});

export const saleLines = sqliteTable("sale_lines", {
  id: text("id").primaryKey(),
  saleId: text("sale_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  productId: text("product_id"),
  productName: text("product_name").notNull(),
  category: text("category").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  unitCostCents: integer("unit_cost_cents"),
  lineDiscountCents: integer("line_discount_cents").notNull(),
  lineDiscountReason: text("line_discount_reason"),
  lineTotalCents: integer("line_total_cents").notNull(),
  createdAt: text("created_at").notNull(),
});

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  originalSaleId: text("original_sale_id").notNull(),
  userId: text("user_id").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
  clientCreatedAt: text("client_created_at").notNull(),
});

export const clientSchema = { products, sales, saleLines, refunds };
