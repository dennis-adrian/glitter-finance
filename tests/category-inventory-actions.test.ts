// The server actions of the non-PowerSync mode for categories and stock
// movements (app/categories/actions.ts, app/inventory/actions.ts), run against
// a stand-in for Drizzle: they check the tenant the screen shows and their
// arguments before any database work, and return expected failures as
// `{ ok: false, error }`.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_TENANT_CHANGED_MESSAGE,
  requireExpectedTenant,
} from "@/lib/auth/tenant-context";
import { stubModule } from "./support/stub-module";

const TENANT_ID = "70000000-0000-4000-8000-000000000001";
const OTHER_TENANT_ID = "70000000-0000-4000-8000-000000000002";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "80000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "72000000-0000-4000-8000-000000000001";

type Write = { kind: string; table: string; values?: unknown };

const writes: Write[] = [];
let productExists = true;
let insertError: unknown = null;
let deleteError: unknown = null;

function tableName(table: unknown) {
  return (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
}

const categoryRow = {
  id: CATEGORY_ID,
  tenantId: TENANT_ID,
  name: "Stickers",
  createdAt: new Date("2026-09-30T12:00:00.000Z"),
  updatedAt: new Date("2026-09-30T12:00:00.000Z"),
};

function fakeDatabase() {
  return {
    select: () => ({
      from: (table: unknown) => {
        // A category's product count has no LIMIT.
        const rows = () =>
          tableName(table) === "categories"
            ? [categoryRow]
            : productExists
              ? [{ id: PRODUCT_ID, value: 0 }]
              : [];
        const where = () =>
          Object.assign(Promise.resolve(rows()), {
            limit: async () => rows(),
          });
        return { where };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          if (insertError) throw insertError;
          writes.push({ kind: "insert", table: tableName(table), values });
          const now = new Date("2026-09-30T12:00:00.000Z");
          return [
            {
              id: "90000000-0000-4000-8000-000000000001",
              note: null,
              createdAt: now,
              updatedAt: now,
              ...values,
            },
          ];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        if (deleteError) throw deleteError;
        writes.push({ kind: "delete", table: tableName(table) });
      },
    }),
  };
}

const fakeDb = {
  ...fakeDatabase(),
  transaction: async <T>(
    run: (tx: ReturnType<typeof fakeDatabase>) => Promise<T>
  ) => run(fakeDatabase()),
};

stubModule("server-only", {});
stubModule("@/lib/db", { db: fakeDb });
stubModule("@/lib/auth/user-context", {
  // The real tenant check, over a user whose active tenant is TENANT_ID.
  requireExpectedTenantContext: async (
    expectedTenantId: unknown,
    missingTenantMessage: string
  ) =>
    requireExpectedTenant(
      {
        user: { id: USER_ID, email: null, displayName: "Vendedora" },
        tenant: { id: TENANT_ID, name: "Puesto" },
        tenants: [],
      } as unknown as Parameters<typeof requireExpectedTenant>[0],
      expectedTenantId,
      missingTenantMessage
    ),
});

test.beforeEach(() => {
  writes.length = 0;
  productExists = true;
  insertError = null;
  deleteError = null;
});

test("a stock movement is recorded for the active tenant and user", async () => {
  const { addInventoryMovement } = await import("@/app/inventory/actions");

  const result = await addInventoryMovement(TENANT_ID, {
    productId: PRODUCT_ID.toUpperCase(),
    delta: 5,
    reason: "restock",
    note: "  Feria  ",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(writes, [
    {
      kind: "insert",
      table: "inventory_movements",
      values: {
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        userId: USER_ID,
        delta: 5,
        reason: "restock",
        note: "Feria",
        createdAt: (writes[0]?.values as { createdAt: Date }).createdAt,
        clientCreatedAt: (writes[0]?.values as { createdAt: Date }).createdAt,
      },
    },
  ]);
});

test("a stock movement is refused before any database work", async () => {
  const { addInventoryMovement } = await import("@/app/inventory/actions");
  const valid = { productId: PRODUCT_ID, delta: 5, reason: "restock" as const };

  const refused: [Promise<unknown>, string | RegExp][] = [
    [
      addInventoryMovement(OTHER_TENANT_ID, valid),
      ACTIVE_TENANT_CHANGED_MESSAGE,
    ],
    [addInventoryMovement(TENANT_ID, { ...valid, delta: -5 }), /de 1 a/],
    [
      addInventoryMovement(TENANT_ID, { ...valid, productId: "producto" }),
      "No se encontró el producto.",
    ],
    [
      addInventoryMovement(
        TENANT_ID,
        null as unknown as Parameters<typeof addInventoryMovement>[1]
      ),
      /./,
    ],
  ];
  for (const [call, message] of refused) {
    const result = (await call) as { ok: boolean; error?: string };
    assert.equal(result.ok, false);
    if (typeof message === "string") assert.equal(result.error, message);
    else assert.match(result.error ?? "", message);
  }
  assert.deepEqual(writes, []);
});

test("a movement for a product the tenant does not have is refused", async () => {
  const { addInventoryMovement } = await import("@/app/inventory/actions");
  productExists = false;

  assert.deepEqual(
    await addInventoryMovement(TENANT_ID, {
      productId: PRODUCT_ID,
      delta: 1,
      reason: "adjustment",
    }),
    { ok: false, error: "No se encontró el producto." }
  );
  assert.deepEqual(writes, []);
});

test("a category is created with the name as it is stored", async () => {
  const { createCategory } = await import("@/app/categories/actions");

  const result = await createCategory(TENANT_ID, "  Arte   impreso ");

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.name, "Arte impreso");
  assert.deepEqual(writes[0]?.values, {
    tenantId: TENANT_ID,
    name: "Arte impreso",
  });
});

test("category actions refuse bad arguments before any database work", async () => {
  const { createCategory, deleteCategory, renameCategory } =
    await import("@/app/categories/actions");

  assert.deepEqual(await createCategory(OTHER_TENANT_ID, "Pines"), {
    ok: false,
    error: ACTIVE_TENANT_CHANGED_MESSAGE,
  });
  assert.deepEqual(await createCategory(TENANT_ID, "todos"), {
    ok: false,
    error:
      '"Todos" es el filtro que muestra todos los productos. Elegí otro nombre.',
  });
  assert.deepEqual(await renameCategory(TENANT_ID, "categoria", "Pines"), {
    ok: false,
    error: "No se encontró la categoría.",
  });
  assert.deepEqual(await deleteCategory(TENANT_ID, "categoria"), {
    ok: false,
    error: "No se encontró la categoría.",
  });
  assert.deepEqual(writes, []);
});

test("a category name the tenant already has is an answer, not a crash", async () => {
  const { createCategory } = await import("@/app/categories/actions");
  insertError = Object.assign(new Error("Failed query"), {
    cause: { code: "23505" },
  });

  assert.deepEqual(await createCategory(TENANT_ID, "stickers"), {
    ok: false,
    error: "Ya existe una categoría con ese nombre.",
  });
});

test("a category a product was just filed under is not deleted", async () => {
  const { deleteCategory } = await import("@/app/categories/actions");
  // The product arrived between the count and the delete.
  deleteError = Object.assign(new Error("Failed query"), {
    cause: { code: "23503" },
  });

  assert.deepEqual(await deleteCategory(TENANT_ID, CATEGORY_ID), {
    ok: false,
    error: "Mové los productos a otra categoría antes de eliminarla.",
  });
});

test("an unused category is deleted", async () => {
  const { deleteCategory } = await import("@/app/categories/actions");

  assert.deepEqual(await deleteCategory(TENANT_ID, CATEGORY_ID), {
    ok: true,
    data: undefined,
  });
  assert.deepEqual(writes, [{ kind: "delete", table: "categories" }]);
});
