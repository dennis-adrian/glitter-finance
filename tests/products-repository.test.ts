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

type Write = {
  kind: "insert" | "update";
  table: "products" | "inventory_movements";
  values: Record<string, unknown>;
};

// Committed writes. A transaction's writes land here only once its callback
// resolves, as in Postgres.
const writes: Write[] = [];
let transactions = 0;
let failMovementInsert = false;
let productWriteError: unknown = null;

const PRINTS_ID = "72000000-0000-4000-8000-000000000001";
const STICKERS_ID = "72000000-0000-4000-8000-000000000002";
const RETIRED_ID = "72000000-0000-4000-8000-000000000003";

// The stored product's category, and the tenant's categories.
let storedCategoryId: string | null = PRINTS_ID;
let tenantCategories = [{ id: PRINTS_ID, name: "Prints" }];

function tableName(table: unknown): Write["table"] {
  return (table as Record<symbol, string>)[Symbol.for("drizzle:Name")] ===
    "inventory_movements"
    ? "inventory_movements"
    : "products";
}

function returningRow(table: Write["table"], values: Record<string, unknown>) {
  if (table === "inventory_movements") {
    return {
      returning: async () => {
        if (failMovementInsert) {
          throw new Error("connection lost");
        }
        return [
          {
            id: "90000000-0000-4000-8000-000000000001",
            note: null,
            ...values,
          },
        ];
      },
    };
  }
  // An update's image path can be an SQL expression, which Postgres would
  // resolve: the row keeps its stored path.
  const { imagePath, ...columns } = values;
  return {
    returning: async () => {
      if (productWriteError) {
        throw productWriteError;
      }
      return [
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
          ...columns,
          ...(typeof imagePath === "string" ? { imagePath } : {}),
        },
      ];
    },
  };
}

function fakeDatabase(log: Write[]) {
  return {
    // The stored product's category, and the tenant's category lookup by id
    // (getCategoryForTenant): the fake finds the first of the tenant's.
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            (table as Record<symbol, string>)[Symbol.for("drizzle:Name")] ===
            "categories"
              ? tenantCategories.slice(0, 1)
              : [{ categoryId: storedCategoryId }],
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        log.push({ kind: "insert", table: tableName(table), values });
        return returningRow(tableName(table), values);
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        log.push({ kind: "update", table: tableName(table), values });
        return { where: () => returningRow(tableName(table), values) };
      },
    }),
  };
}

const fakeDb = {
  ...fakeDatabase(writes),
  transaction: async <T>(
    run: (tx: ReturnType<typeof fakeDatabase>) => Promise<T>
  ) => {
    transactions += 1;
    const pending: Write[] = [];
    const result = await run(fakeDatabase(pending));
    writes.push(...pending);
    return result;
  },
};

function reset() {
  writes.length = 0;
  transactions = 0;
  failMovementInsert = false;
  productWriteError = null;
  storedCategoryId = PRINTS_ID;
  tenantCategories = [{ id: PRINTS_ID, name: "Prints" }];
}

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
  reset();

  const before = Date.now();
  const { product, initialMovement } = await createProductForTenant(TENANT_ID, {
    name: "Print",
    priceCents: 4000,
    costCents: null,
    categoryId: PRINTS_ID,
  });
  assert.equal(initialMovement, null);
  await updateProductImageForTenant(
    TENANT_ID,
    product.id,
    `${TENANT_ID}/products/${product.id}/a4000000-0000-4000-8000-000000000001.jpg`
  );
  const after = Date.now();

  const [insert, update] = writes;
  assert.equal(insert?.kind, "insert");
  // Stored by id, with the category's name next to it.
  assert.equal(insert.values.categoryId, PRINTS_ID);
  assert.equal(insert.values.category, "Prints");
  assert.ok(insert.values.createdAt instanceof Date);
  assert.equal(insert.values.updatedAt, insert.values.createdAt);
  const createdAt = (insert.values.createdAt as Date).getTime();
  assert.ok(before <= createdAt && createdAt <= after);

  assert.equal(update?.kind, "update");
  assert.ok(update.values.updatedAt instanceof Date);
  assert.ok((update.values.updatedAt as Date).getTime() >= createdAt);
});

const USER_ID = "a0000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "80000000-0000-4000-8000-000000000001";
const trackedProduct = {
  name: "Print",
  priceCents: 4000,
  costCents: null,
  categoryId: PRINTS_ID,
  tracksInventory: true,
};

test("a product saved with a count records it in the same transaction", async () => {
  const { createProductForTenant } = await repository();
  reset();

  const { product, initialMovement } = await createProductForTenant(
    TENANT_ID,
    trackedProduct,
    { userId: USER_ID, delta: 0 }
  );

  assert.equal(transactions, 1);
  assert.deepEqual(
    writes.map((write) => [write.kind, write.table]),
    [
      ["insert", "products"],
      ["insert", "inventory_movements"],
    ]
  );
  const [insert, movement] = writes;
  assert.deepEqual(
    {
      tenantId: movement?.values.tenantId,
      productId: movement?.values.productId,
      userId: movement?.values.userId,
      delta: movement?.values.delta,
      reason: movement?.values.reason,
    },
    {
      tenantId: TENANT_ID,
      productId: product.id,
      userId: USER_ID,
      delta: 0,
      reason: "initial",
    }
  );
  // Stamped with the product's time, by the same clock.
  assert.equal(movement?.values.createdAt, insert?.values.createdAt);
  assert.equal(movement?.values.clientCreatedAt, insert?.values.createdAt);
  assert.equal(initialMovement?.productId, product.id);
  assert.equal(initialMovement?.delta, 0);
  assert.equal(initialMovement?.reason, "initial");
});

test("switching tracking on records the count with the product update", async () => {
  const { updateProductForTenant } = await repository();
  reset();

  const { initialMovement } = await updateProductForTenant(
    TENANT_ID,
    PRODUCT_ID,
    trackedProduct,
    { userId: USER_ID, delta: 12 }
  );

  assert.equal(transactions, 1);
  assert.deepEqual(
    writes.map((write) => [write.kind, write.table]),
    [
      ["update", "products"],
      ["insert", "inventory_movements"],
    ]
  );
  const [update, movement] = writes;
  assert.equal(update?.values.tracksInventory, true);
  assert.equal(movement?.values.createdAt, update?.values.updatedAt);
  assert.equal(initialMovement?.delta, 12);
});

test("a count that is not recorded leaves the product unchanged", async () => {
  const { updateProductForTenant } = await repository();
  reset();
  failMovementInsert = true;

  await assert.rejects(
    updateProductForTenant(TENANT_ID, PRODUCT_ID, trackedProduct, {
      userId: USER_ID,
      delta: 12,
    }),
    /connection lost/
  );
  // Tracking was not switched on without its count.
  assert.deepEqual(writes, []);
});

test("an invalid count is refused before anything is written", async () => {
  const { createProductForTenant } = await repository();
  reset();

  for (const delta of [-1, 1.5, Number.NaN, "5" as unknown as number]) {
    await assert.rejects(
      createProductForTenant(TENANT_ID, trackedProduct, {
        userId: USER_ID,
        delta,
      }),
      { name: "UserFacingError" }
    );
  }
  assert.equal(transactions, 0);
  assert.deepEqual(writes, []);
});

test("an edit keeps a category the tenant no longer has", async () => {
  const { updateProductForTenant } = await repository();

  // The same category, or none picked (null keeps it).
  for (const categoryId of [RETIRED_ID, null]) {
    reset();
    storedCategoryId = RETIRED_ID;
    tenantCategories = [];

    await updateProductForTenant(TENANT_ID, PRODUCT_ID, {
      ...trackedProduct,
      categoryId,
    });

    // Neither column is written, so neither gets a newer edit time.
    assert.equal("categoryId" in (writes[0]?.values ?? {}), false);
    assert.equal("category" in (writes[0]?.values ?? {}), false);
  }
});

test("an edit to another category writes its id and name", async () => {
  const { updateProductForTenant } = await repository();
  reset();
  tenantCategories = [{ id: STICKERS_ID, name: "Stickers" }];

  await updateProductForTenant(TENANT_ID, PRODUCT_ID, {
    ...trackedProduct,
    categoryId: STICKERS_ID,
  });

  assert.equal(writes[0]?.values.categoryId, STICKERS_ID);
  assert.equal(writes[0]?.values.category, "Stickers");
});

test("an edit cannot move a product to a category the tenant does not have", async () => {
  const { updateProductForTenant } = await repository();
  reset();
  tenantCategories = [];

  await assert.rejects(
    updateProductForTenant(TENANT_ID, PRODUCT_ID, {
      ...trackedProduct,
      categoryId: STICKERS_ID,
    }),
    { name: "UserFacingError", message: "Elegí una categoría válida." }
  );
  assert.deepEqual(writes, []);
});

test("a new product needs one of the tenant's categories", async () => {
  const { createProductForTenant } = await repository();
  reset();
  tenantCategories = [];

  for (const categoryId of [STICKERS_ID, null]) {
    await assert.rejects(
      createProductForTenant(TENANT_ID, { ...trackedProduct, categoryId }),
      { name: "UserFacingError", message: "Elegí una categoría válida." }
    );
  }
  assert.deepEqual(writes, []);
});

test("a category deleted during the save is refused as invalid", async () => {
  const { createProductForTenant } = await repository();
  reset();
  // As Drizzle wraps the postgres.js error.
  productWriteError = {
    message: "Failed query",
    cause: {
      code: "23503",
      constraint_name:
        "products_category_id_tenant_id_categories_id_tenant_id_fk",
    },
  };

  await assert.rejects(createProductForTenant(TENANT_ID, trackedProduct), {
    name: "UserFacingError",
    message: "Elegí una categoría válida.",
  });

  // Any other foreign key is not about the category.
  const otherError = {
    cause: { code: "23503", constraint_name: "products_tenant_id_fk" },
  };
  productWriteError = otherError;
  await assert.rejects(
    createProductForTenant(TENANT_ID, trackedProduct),
    (error) => error === otherError
  );
});
