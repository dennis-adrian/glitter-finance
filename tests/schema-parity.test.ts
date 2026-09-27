import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as client from "@/lib/db/client-schema";
import * as server from "@/lib/db/schema";
import type { InventoryMovementReason } from "@/lib/inventory";
import { AppSchema } from "@/lib/powersync/schema";
import { paymentLabels } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/types";

// The sync rules use SELECT *, so a Postgres column missing from the client
// schema is silently dropped on every device.
const syncedTables: [Table, Table][] = [
  [server.products, client.products],
  [server.sales, client.sales],
  [server.saleLines, client.saleLines],
  [server.refunds, client.refunds],
  [server.tenantUsers, client.tenantUsers],
  [server.inventoryMovements, client.inventoryMovements],
];

function columnShape(table: Table) {
  return Object.fromEntries(
    Object.values(getTableColumns(table)).map((column) => [
      column.name,
      { notNull: column.notNull },
    ])
  );
}

test("every table in the sync rules has a client-schema mirror", () => {
  const rules = readFileSync("powersync/sync-rules.yaml", "utf8");
  const ruleTables = [...rules.matchAll(/SELECT \* FROM (\w+)/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(
    syncedTables.map(([table]) => getTableName(table)).sort(),
    ruleTables
  );
});

test("client schema mirrors the synced Postgres columns and nullability", () => {
  for (const [serverTable, clientTable] of syncedTables) {
    assert.equal(getTableName(clientTable), getTableName(serverTable));
    assert.deepEqual(
      columnShape(clientTable),
      columnShape(serverTable),
      getTableName(serverTable)
    );
  }
});

test("local SQLite indexes cover the on-device point lookups", () => {
  const indexes = Object.fromEntries(
    AppSchema.tables.map((table) => [
      table.name,
      table.indexes.map((index) => index.columns.map((column) => column.name)),
    ])
  );

  assert.deepEqual(indexes.refunds, [["original_sale_id"]]);
  assert.deepEqual(indexes.inventory_movements, [["product_id", "reason"]]);
  AppSchema.validate();
});

// Compile-time guards: the unions are derived from the pgEnums, and must stay
// literal unions (a widened `string` would silently accept any value).
const paymentMethodIsLiteral: string extends PaymentMethod ? false : true =
  true;
const movementReasonIsLiteral: string extends InventoryMovementReason
  ? false
  : true = true;

test("TypeScript enum unions match the Postgres enums", () => {
  assert.ok(paymentMethodIsLiteral && movementReasonIsLiteral);
  assert.deepEqual(
    Object.keys(paymentLabels).sort(),
    [...server.paymentMethodEnum.enumValues].sort()
  );
});
