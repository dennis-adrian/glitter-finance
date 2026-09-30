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
//   truth). tests/schema-parity.test.ts keeps columns and nullability in step
//   with lib/db/schema.ts.
// - Indexes are local SQLite indexes that PowerSync creates on the synced
//   rows; declare one only for a lookup the app actually runs on the device.
//
// Not yet synced:
// - tenants — single row per tenant; not worth a sync bucket.
//
// Server-only columns (the sync rules send them, the local views leave them
// out):
// - products.field_updated_at — per-column edit times, kept by the
//   last-write-wins trigger in Postgres.

import type { Column, Table } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

type LocalValue<C extends Column> = C["_"]["notNull"] extends true
  ? C["_"]["data"]
  : C["_"]["data"] | null;

/**
 * A row of `T` as raw SQL reads it from the local database: keyed by the
 * SQLite column name (snake_case, as PowerSync replicates it) rather than by
 * the Drizzle property name. Local reads are plain SQL, so this is the one
 * place their row shapes come from.
 */
export type LocalRow<T extends Table> = {
  [K in keyof T["_"]["columns"] as T["_"]["columns"][K]["_"]["name"]]: LocalValue<
    T["_"]["columns"][K]
  >;
};

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents"),
    category: text("category").notNull(),
    imagePath: text("image_path"),
    tracksInventory: integer("tracks_inventory").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // Renaming or deleting a category looks up the products filed under it
  // (lib/powersync/write-categories.ts).
  (table) => [index("category").on(table.category)]
);

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
  productId: text("product_id").notNull(),
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

export const refunds = sqliteTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    originalSaleId: text("original_sale_id").notNull(),
    userId: text("user_id").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
    clientCreatedAt: text("client_created_at").notNull(),
  },
  // Void and refund writes look up a sale's refund by original_sale_id.
  (table) => [index("original_sale_id").on(table.originalSaleId)]
);

export const tenantUsers = sqliteTable("tenant_users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    userId: text("user_id").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    clientCreatedAt: text("client_created_at").notNull(),
  },
  // The product editor checks whether a product already has an `initial`.
  (table) => [index("product_reason").on(table.productId, table.reason)]
);

export const draftCart = sqliteTable("draft_cart", {
  id: text("id").primaryKey(),
  linesJson: text("lines_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Durable local dead-letter records. When the server permanently rejects an
// upload, its complete payload and error are captured here while the
// transaction stays at the head of the PowerSync CRUD queue, so financial sync
// failures are visible and recoverable instead of disappearing into console
// output. A marker is resolved once its transaction leaves the queue, either
// uploaded after a retry or discarded from Diagnostics (discarded_at, set
// before the transaction leaves the queue); the record, payload included,
// stays until the local data is cleared.
export const syncFailures = sqliteTable("sync_failures", {
  id: text("id").primaryKey(),
  transactionId: integer("transaction_id"),
  tenantId: text("tenant_id"),
  operationsJson: text("operations_json").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message").notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  discardedAt: text("discarded_at"),
});

// The upload the server keeps deferring because one of its device timestamps
// is more than 5 minutes ahead of the server clock (Postgres 55000). Unlike a
// sync failure it is not permanent: the transaction uploads once the server
// clock catches up. The row only explains the wait; it applies while its
// transaction is at the head of the upload queue (lib/powersync/upload-holds.ts).
export const uploadHolds = sqliteTable("upload_holds", {
  id: text("id").primaryKey(),
  transactionId: integer("transaction_id").notNull(),
  // When the server clock will accept every timestamp in the transaction.
  heldUntil: text("held_until"),
  errorMessage: text("error_message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const clientSchema = {
  categories,
  products,
  sales,
  saleLines,
  refunds,
  tenantUsers,
  inventoryMovements,
  draftCart: {
    tableDefinition: draftCart,
    options: { localOnly: true },
  },
  syncFailures: {
    tableDefinition: syncFailures,
    options: { localOnly: true },
  },
  uploadHolds: {
    tableDefinition: uploadHolds,
    options: { localOnly: true },
  },
};
