import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { addInventoryMovement } from "@/lib/powersync/write-inventory";
import {
  createProductLocal,
  uploadProductImageLocal,
} from "@/lib/powersync/write-products";
import { createSaleLocal } from "@/lib/powersync/write-sales";
import type { Product } from "@/lib/types";

const cancelled = () => {
  throw new Error("tenant work cancelled");
};

test("local writers check cancellation before committing SQLite mutations", async () => {
  let directWrites = 0;
  const directDb = {
    execute: async () => {
      directWrites += 1;
    },
  } as unknown as AbstractPowerSyncDatabase;

  await assert.rejects(
    createProductLocal(directDb, {
      tenantId: "tenant-1",
      product: {
        name: "Producto",
        priceCents: 100,
        costCents: null,
        category: "General",
        imageTone: "violet",
        tracksInventory: false,
      },
      assertCurrent: cancelled,
    }),
    /tenant work cancelled/
  );
  assert.equal(directWrites, 0);

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
