// Server-action product writes (lib/products/repository.ts), run against a
// stand-in for Drizzle.
//
// Postgres keeps, per column, the edit with the newer updated_at
// (supabase/manual/20260926130100_products_last_write_wins.sql). Every write
// here must therefore take its times from one clock: an insert stamped by
// Postgres' now() followed by an update stamped by a lagging app server would
// have the update dropped.

import assert from "node:assert/strict";
import test from "node:test";
import { stubModule } from "./support/stub-module";

stubModule("server-only", {});

const TENANT_ID = "70000000-0000-4000-8000-000000000001";

const writes: { kind: "insert" | "update"; values: Record<string, unknown> }[] =
  [];

function returningRow(values: Record<string, unknown>) {
  return {
    returning: async () => [
      {
        id: "80000000-0000-4000-8000-000000000001",
        name: "Print",
        priceCents: 4000,
        costCents: null,
        category: "Prints",
        imagePath: "placeholder:violet",
        tracksInventory: false,
        lowStockThreshold: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...values,
      },
    ],
  };
}

const fakeDb = {
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      writes.push({ kind: "insert", values });
      return returningRow(values);
    },
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      writes.push({ kind: "update", values });
      return { where: () => returningRow(values) };
    },
  }),
};

async function repository() {
  // lib/db reads its Drizzle instance from this global when one is set.
  Object.assign(globalThis, { glitterDb: fakeDb, glitterPostgres: {} });
  Object.assign(process.env, {
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/unused",
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "publishable-key",
  });
  return import("@/lib/products/repository");
}

test("a new product is stamped by the app server's clock, like its updates", async () => {
  const { createProductForTenant, updateProductImageForTenant } =
    await repository();
  writes.length = 0;

  const before = Date.now();
  const product = await createProductForTenant(TENANT_ID, {
    name: "Print",
    priceCents: 4000,
    costCents: null,
    category: "Prints",
  });
  await updateProductImageForTenant(
    TENANT_ID,
    product.id,
    `${TENANT_ID}/products/${product.id}/a4000000-0000-4000-8000-000000000001.jpg`
  );
  const after = Date.now();

  const [insert, update] = writes;
  assert.equal(insert?.kind, "insert");
  assert.ok(insert.values.createdAt instanceof Date);
  assert.equal(insert.values.updatedAt, insert.values.createdAt);
  const createdAt = (insert.values.createdAt as Date).getTime();
  assert.ok(before <= createdAt && createdAt <= after);

  assert.equal(update?.kind, "update");
  assert.ok(update.values.updatedAt instanceof Date);
  assert.ok((update.values.updatedAt as Date).getTime() >= createdAt);
});
