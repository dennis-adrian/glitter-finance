import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { addInventoryMovement } from "@/lib/powersync/write-inventory";
import {
  archiveProductLocal,
  createProductLocal,
  PRODUCT_NOT_ON_DEVICE_MESSAGE,
  restoreProductLocal,
  updateProductLocal,
  uploadProductImageLocal,
} from "@/lib/powersync/write-products";
import {
  createSaleLocal,
  refundSaleLocal,
  SALE_NOT_ON_DEVICE_MESSAGE,
  voidSaleLocal,
} from "@/lib/powersync/write-sales";
import type { Product } from "@/lib/types";

const cancelled = () => {
  throw new Error("tenant work cancelled");
};

test("local writers check cancellation before committing SQLite mutations", async () => {
  let transactionWrites = 0;
  const transactionDb = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        execute: async () => {
          transactionWrites += 1;
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(
    createProductLocal(transactionDb, {
      tenantId: "tenant-1",
      product: {
        name: "Producto",
        priceCents: 100,
        costCents: null,
        category: "General",
        imageTone: "violet",
        tracksInventory: true,
      },
      initialStock: { userId: "user-1", delta: 5 },
      assertCurrent: cancelled,
    }),
    /tenant work cancelled/
  );

  await assert.rejects(
    addInventoryMovement(transactionDb, {
      tenantId: "tenant-1",
      userId: "user-1",
      productId: "product-1",
      delta: 1,
      reason: "adjustment",
      assertCurrent: cancelled,
    }),
    /tenant work cancelled/
  );

  await assert.rejects(
    createSaleLocal(transactionDb, {
      tenantId: "tenant-1",
      userId: "user-1",
      paymentMethod: "cash",
      saleDiscountCents: 0,
      lines: [
        {
          product: {
            id: "product-1",
            name: "Producto",
            priceCents: 100,
            costCents: null,
            category: "General",
            archivedAt: null,
          } as Product,
          quantity: 1,
        },
      ],
      assertCurrent: cancelled,
    }),
    /tenant work cancelled/
  );
  assert.equal(transactionWrites, 0);
});

test("image metadata write re-checks cancellation after storage upload", async () => {
  let checks = 0;
  let metadataWrites = 0;
  let removed = false;
  const db = {
    getOptional: async () => ({ id: "product-1" }),
    execute: async () => {
      metadataWrites += 1;
    },
  } as unknown as AbstractPowerSyncDatabase;
  const supabase = {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => {
          removed = true;
          return { error: null };
        },
      }),
    },
  };

  await assert.rejects(
    uploadProductImageLocal(supabase as never, db, {
      tenantId: "tenant-1",
      productId: "product-1",
      file: { size: 1, type: "image/png" } as File,
      assertCurrent: () => {
        checks += 1;
        if (checks > 1) {
          cancelled();
        }
      },
    }),
    /tenant work cancelled/
  );

  assert.equal(metadataWrites, 0);
  assert.equal(removed, true);
});

test("product edits refuse a product that is not on the device yet", async () => {
  let uploads = 0;
  let writes = 0;
  const db = {
    getOptional: async () => null,
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        getOptional: async () => null,
        execute: async () => {
          writes += 1;
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
  const input = { tenantId: "tenant-1", productId: "product-1" };
  const product = {
    name: "Producto",
    priceCents: 100,
    costCents: null,
    category: "General",
    imageTone: "violet",
    tracksInventory: false,
  };
  const supabase = {
    storage: {
      from: () => ({
        upload: async () => {
          uploads += 1;
          return { error: null };
        },
      }),
    },
  };

  for (const edit of [
    updateProductLocal(db, { ...input, product }),
    archiveProductLocal(db, input),
    restoreProductLocal(db, input),
    uploadProductImageLocal(supabase as never, db, {
      ...input,
      file: { size: 1, type: "image/png" } as File,
    }),
  ]) {
    await assert.rejects(edit, (error: Error) => {
      assert.equal(error.message, PRODUCT_NOT_ON_DEVICE_MESSAGE);
      return true;
    });
  }
  assert.equal(writes, 0);
  assert.equal(uploads, 0);
});

function saleDb(sale: { tenant_id: string } | null) {
  let writes = 0;
  const db = {
    writeTransaction: async <T>(callback: (tx: Transaction) => Promise<T>) =>
      callback({
        getAll: async (sql: string) =>
          /FROM sales/.test(sql) && sale ? [sale] : [],
        execute: async () => {
          writes += 1;
        },
      } as unknown as Transaction),
  } as unknown as AbstractPowerSyncDatabase;
  return { db, writes: () => writes };
}

test("a void or refund of a sale not on the device yet says it is syncing", async () => {
  const { db, writes } = saleDb(null);
  const input = { saleId: "sale-1", userId: "user-1", tenantId: "tenant-1" };

  for (const write of [voidSaleLocal(db, input), refundSaleLocal(db, input)]) {
    await assert.rejects(write, (error: Error) => {
      assert.equal(error.message, SALE_NOT_ON_DEVICE_MESSAGE);
      return true;
    });
  }
  assert.equal(writes(), 0);
});

test("a void or refund of another tenant's sale is refused as not found", async () => {
  const { db, writes } = saleDb({ tenant_id: "tenant-2" });
  const input = { saleId: "sale-1", userId: "user-1", tenantId: "tenant-1" };

  for (const write of [voidSaleLocal(db, input), refundSaleLocal(db, input)]) {
    await assert.rejects(write, /No se encontró la venta\./);
  }
  assert.equal(writes(), 0);
});
