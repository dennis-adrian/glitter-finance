import assert from "node:assert/strict";
import test from "node:test";
import { UserFacingError } from "@/lib/action-result";
import { inventoryMovementReasonEnum } from "@/lib/db/schema";
import {
  computeStockByProduct,
  isValidMovementDelta,
  MAX_QUANTITY,
  movementDeltaError,
  normalizeInventoryMovement,
  resolveInitialStockDelta,
  type InventoryMovement,
} from "@/lib/inventory";
import type { Sale } from "@/lib/types";

const PRODUCT = "product-1";

function movement(
  id: string,
  reason: InventoryMovement["reason"],
  delta: number,
  createdAt: string
) {
  return { id, productId: PRODUCT, reason, delta, createdAt };
}

function sale(
  id: string,
  quantity: number,
  createdAt: string,
  extra: Partial<Sale> = {}
): Sale {
  return {
    id,
    tenantId: "tenant-1",
    userId: "user-1",
    userName: "Vendedora",
    createdAt,
    paymentMethod: "cash",
    saleDiscountCents: 0,
    status: "completed",
    lines: [
      {
        id: `${id}-line`,
        productId: PRODUCT,
        productName: "Sticker",
        category: "Stickers",
        quantity,
        unitPriceCents: 1000,
        unitCostCents: null,
        lineDiscountCents: 0,
        lineTotalCents: 1000 * quantity,
      },
    ],
    ...extra,
  };
}

test("without an initial count every sale is subtracted from supply", () => {
  const stock = computeStockByProduct(
    [movement("m1", "restock", 5, "2026-09-03T10:00:00.000Z")],
    [
      sale("s1", 2, "2026-09-01T10:00:00.000Z"),
      sale("s2", 2, "2026-09-02T10:00:00.000Z"),
    ]
  );

  assert.equal(stock.get(PRODUCT), 1);
});

test("a zero initial starts tracking without counting earlier sales", () => {
  const stock = computeStockByProduct(
    [
      movement("m1", "initial", 0, "2026-09-02T10:00:00.000Z"),
      movement("m2", "restock", 5, "2026-09-03T10:00:00.000Z"),
    ],
    [
      sale("s1", 3, "2026-09-01T10:00:00.000Z"),
      sale("s2", 2, "2026-09-04T10:00:00.000Z"),
    ]
  );

  assert.equal(stock.get(PRODUCT), 3);
});

test("the latest initial is the baseline when a product has several", () => {
  const stock = computeStockByProduct(
    [
      movement("m1", "initial", 10, "2026-09-01T10:00:00.000Z"),
      movement("m2", "restock", 7, "2026-09-01T11:00:00.000Z"),
      movement("m3", "initial", 4, "2026-09-02T10:00:00.000Z"),
    ],
    [
      sale("s1", 2, "2026-09-01T12:00:00.000Z"),
      sale("s2", 1, "2026-09-03T10:00:00.000Z"),
    ]
  );

  assert.equal(stock.get(PRODUCT), 3);
});

test("timestamps are compared as instants across local and synced formats", () => {
  // The count was recorded on this device (toISOString, milliseconds); the
  // restock and sales came back from Postgres with microseconds or a space
  // separator. As strings, every one of them sorts before the count.
  const stock = computeStockByProduct(
    [
      movement("m1", "initial", 10, "2026-09-03T10:00:00.123Z"),
      movement("m2", "restock", 5, "2026-09-03 10:00:00.5+00"),
    ],
    [
      sale("s1", 2, "2026-09-03T10:00:00.123400Z"),
      sale("s2", 1, "2026-09-03T10:00:00.9+00:00"),
      sale("s3", 4, "2026-09-03T10:00:00.122999Z"),
    ]
  );

  assert.equal(stock.get(PRODUCT), 10 + 5 - 2 - 1);
});

test("a later count in another format still replaces the baseline", () => {
  const stock = computeStockByProduct(
    [
      movement("m1", "initial", 10, "2026-09-03T10:00:00.900Z"),
      movement("m2", "initial", 4, "2026-09-03 10:00:01+00"),
    ],
    [sale("s1", 1, "2026-09-03T10:00:00.950Z")]
  );

  assert.equal(stock.get(PRODUCT), 4);
});

test("initials recorded at the same instant converge on one by id", () => {
  const at = "2026-09-01T10:00:00.000Z";
  const forward = computeStockByProduct(
    [movement("a", "initial", 10, at), movement("b", "initial", 6, at)],
    []
  );
  const reversed = computeStockByProduct(
    [movement("b", "initial", 6, at), movement("a", "initial", 10, at)],
    []
  );

  assert.equal(forward.get(PRODUCT), 6);
  assert.equal(reversed.get(PRODUCT), 6);
});

test("voided sales are ignored and refunds return units", () => {
  const original = sale("s1", 3, "2026-09-02T10:00:00.000Z");
  const stock = computeStockByProduct(
    [movement("m1", "initial", 10, "2026-09-01T10:00:00.000Z")],
    [
      original,
      sale("s2", 4, "2026-09-02T11:00:00.000Z", { status: "voided" }),
      {
        ...original,
        id: "r1",
        createdAt: "2026-09-03T10:00:00.000Z",
        status: "refunded",
        refundOfSaleId: original.id,
      },
    ]
  );

  assert.equal(stock.get(PRODUCT), 10);
});

test("movement deltas follow the Postgres sign discipline for every reason", () => {
  const cases: Record<
    (typeof inventoryMovementReasonEnum.enumValues)[number],
    {
      valid: number[];
      invalid: number[];
    }
  > = {
    initial: { valid: [0, 1, 25], invalid: [-1, 1.5] },
    restock: { valid: [1, 25], invalid: [0, -1, 2.5] },
    adjustment: { valid: [-3, 3], invalid: [0, 0.5] },
    loss: { valid: [-1], invalid: [0, 1] },
    gift: { valid: [-1], invalid: [0, 1] },
  };

  for (const reason of inventoryMovementReasonEnum.enumValues) {
    for (const delta of cases[reason].valid) {
      assert.equal(isValidMovementDelta(reason, delta), true, reason);
    }
    for (const delta of cases[reason].invalid) {
      assert.equal(isValidMovementDelta(reason, delta), false, reason);
    }
  }
});

test("movement deltas stay within the quantity bound", () => {
  assert.equal(isValidMovementDelta("restock", MAX_QUANTITY), true);
  assert.equal(isValidMovementDelta("restock", MAX_QUANTITY + 1), false);
  assert.equal(isValidMovementDelta("loss", -MAX_QUANTITY), true);
  assert.equal(isValidMovementDelta("gift", -(MAX_QUANTITY + 1)), false);
  assert.equal(isValidMovementDelta("adjustment", -(MAX_QUANTITY + 1)), false);
  assert.equal(isValidMovementDelta("initial", Number.NaN), false);
  assert.equal(
    isValidMovementDelta("unknown" as InventoryMovement["reason"], 1),
    false
  );
  assert.match(movementDeltaError("initial"), /0 a 1\.000\.000/);
});

test("movements from a server action get the local writer's checks", () => {
  assert.deepEqual(
    normalizeInventoryMovement({ delta: 0, reason: "initial", note: "  " }),
    { delta: 0, reason: "initial", note: null }
  );
  assert.deepEqual(
    normalizeInventoryMovement({ delta: -2, reason: "loss", note: " rota " }),
    { delta: -2, reason: "loss", note: "rota" }
  );

  const invalid: [Record<string, unknown>, RegExp][] = [
    [{ delta: 3, reason: "loss" }, /entero de 1/],
    [{ delta: "5", reason: "restock" }, /entero de 1/],
    [{ delta: 5 }, /tipo de movimiento/],
    [{ delta: 5, reason: "sale" }, /tipo de movimiento/],
    [{ delta: 5, reason: "restock", note: 42 }, /nota/],
  ];
  for (const [input, message] of invalid) {
    assert.throws(
      () => normalizeInventoryMovement(input),
      (error: unknown) =>
        error instanceof UserFacingError && message.test(error.message),
      JSON.stringify(input)
    );
  }
});

test("switching tracking on always records an initial count", () => {
  const base = { tracksInventory: true, hasInitialMovement: false };

  assert.equal(
    resolveInitialStockDelta({ ...base, wasTrackingInventory: false }),
    0
  );
  assert.equal(
    resolveInitialStockDelta({
      ...base,
      wasTrackingInventory: false,
      initialStock: 12,
    }),
    12
  );
  assert.equal(
    resolveInitialStockDelta({
      ...base,
      wasTrackingInventory: false,
      initialStock: 0,
    }),
    0
  );
});

test("an initial is only written when one is missing and wanted", () => {
  // Already tracked without a baseline: blank keeps earlier restocks.
  assert.equal(
    resolveInitialStockDelta({
      tracksInventory: true,
      wasTrackingInventory: true,
      hasInitialMovement: false,
    }),
    null
  );
  assert.equal(
    resolveInitialStockDelta({
      tracksInventory: true,
      wasTrackingInventory: true,
      hasInitialMovement: false,
      initialStock: 0,
    }),
    0
  );
  assert.equal(
    resolveInitialStockDelta({
      tracksInventory: true,
      wasTrackingInventory: false,
      hasInitialMovement: true,
      initialStock: 5,
    }),
    null
  );
  assert.equal(
    resolveInitialStockDelta({
      tracksInventory: false,
      wasTrackingInventory: false,
      hasInitialMovement: false,
      initialStock: 5,
    }),
    null
  );
});
