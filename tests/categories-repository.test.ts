// A category rename in the non-PowerSync mode (renameCategoryForTenant in
// lib/categories/repository.ts), run against a stand-in for Drizzle.
//
// Products follow their category by id, and Postgres keeps their name in
// step. The repository renames them too, for databases without the manual
// SQL, as a maintenance write: it leaves products.updated_at alone, so a
// newer edit from a device keeps its per-column time
// (supabase/manual/20261009120000_product_category_ids.sql, rule I4).

import assert from "node:assert/strict";
import test from "node:test";

const TENANT_ID = "70000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "72000000-0000-4000-8000-000000000001";

type Write = { table: string; values: Record<string, unknown> };

const writes: Write[] = [];
let categoryExists = true;

function tableName(table: unknown) {
  return (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
}

function fakeDatabase() {
  return {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          writes.push({ table: tableName(table), values });
          return Object.assign(Promise.resolve(), {
            returning: async () =>
              categoryExists
                ? [
                    {
                      id: CATEGORY_ID,
                      tenantId: TENANT_ID,
                      createdAt: new Date("2026-09-30T12:00:00.000Z"),
                      updatedAt: new Date("2026-09-30T12:00:00.000Z"),
                      ...values,
                    },
                  ]
                : [],
          });
        },
      }),
    }),
  };
}

const fakeDb = {
  ...fakeDatabase(),
  transaction: async <T>(
    run: (tx: ReturnType<typeof fakeDatabase>) => Promise<T>
  ) => run(fakeDatabase()),
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
  return import("@/lib/categories/repository");
}

test("a rename renames the category's products without a newer edit time", async () => {
  const { renameCategoryForTenant } = await repository();
  writes.length = 0;
  categoryExists = true;

  const renamed = await renameCategoryForTenant(
    TENANT_ID,
    CATEGORY_ID,
    "  Arte   impreso "
  );

  assert.equal(renamed.name, "Arte impreso");
  assert.deepEqual(
    writes.map((write) => write.table),
    ["categories", "products"]
  );
  assert.ok(writes[0].values.updatedAt instanceof Date);
  assert.deepEqual(writes[1].values, { category: "Arte impreso" });
});

test("renaming a category the tenant does not have writes no products", async () => {
  const { renameCategoryForTenant } = await repository();
  writes.length = 0;
  categoryExists = false;

  await assert.rejects(
    renameCategoryForTenant(TENANT_ID, CATEGORY_ID, "Pines"),
    { name: "UserFacingError", message: "No se encontró la categoría." }
  );
  assert.deepEqual(
    writes.map((write) => write.table),
    ["categories"]
  );
});
