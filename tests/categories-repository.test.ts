// The categories '/' creates from a tenant's catalog
// (ensureCategoriesForExistingProducts in lib/categories/repository.ts), run
// against a stand-in for Drizzle.

import assert from "node:assert/strict";
import test from "node:test";

const TENANT_ID = "70000000-0000-4000-8000-000000000001";

// The product category names that no category matches yet, as Postgres would
// return them, and the rows inserted.
let missingNames: string[] = [];
const inserted: Record<string, unknown>[][] = [];

const fakeDb = {
  selectDistinct: () => ({
    from: () => ({
      where: async () => missingNames.map((name) => ({ name })),
    }),
  }),
  // The NOT EXISTS subquery: built, never run on its own.
  select: () => ({ from: () => ({ where: () => ({}) }) }),
  insert: () => ({
    values: (values: Record<string, unknown>[]) => {
      inserted.push(values);
      return { onConflictDoNothing: async () => undefined };
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
  return import("@/lib/categories/repository");
}

test("a tenant whose product categories all exist writes nothing", async () => {
  const { ensureCategoriesForExistingProducts } = await repository();
  missingNames = [];
  inserted.length = 0;

  await ensureCategoriesForExistingProducts(TENANT_ID);

  assert.deepEqual(inserted, []);
});

test("creates one category per missing name, as a category may be named", async () => {
  const { ensureCategoriesForExistingProducts } = await repository();
  missingNames = [
    "  Arte   impreso ",
    "arte impreso",
    "Pines",
    "x".repeat(41),
    "Todos",
    "   ",
  ];
  inserted.length = 0;

  await ensureCategoriesForExistingProducts(TENANT_ID);

  assert.deepEqual(inserted, [
    [
      { tenantId: TENANT_ID, name: "Arte impreso" },
      { tenantId: TENANT_ID, name: "Pines" },
    ],
  ]);
});
