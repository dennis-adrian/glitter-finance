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
  productHasInitialMovement,
  resolveInitialStockDelta,
  type InventoryMovement,
  type OpeningStock,
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

/** Deterministic pseudo-random numbers in [0, 1), so a failure reproduces. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

const LEDGER_START = Date.parse("2026-08-01T00:00:00.000Z");
const HOUR_MS = 3_600_000;

/**
 * A random ledger over a few products: every movement reason, voided sales,
 * and refunds, some of them recorded at the same millisecond (or within one,
 * in microseconds, as Postgres returns them).
 */
function randomLedger(seed: number) {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)];
  const productIds = ["p-a", "p-b", "p-c"];
  const at = () => {
    const ms = LEDGER_START + Math.floor(random() * 40) * HOUR_MS;
    const iso = new Date(ms).toISOString();
    return random() < 0.3 ? iso.replace("Z", "456Z") : iso;
  };
  const deltaFor: Record<InventoryMovement["reason"], () => number> = {
    initial: () => Math.floor(random() * 20),
    restock: () => 1 + Math.floor(random() * 10),
    adjustment: () => pick([-3, -1, 2, 5]),
    loss: () => -1 - Math.floor(random() * 3),
    gift: () => -1,
  };

  const movements = Array.from({ length: 30 }, (_, index) => {
    const reason = pick(inventoryMovementReasonEnum.enumValues);
    return {
      id: `m-${String(index).padStart(2, "0")}`,
      productId: pick(productIds),
      reason,
      delta: deltaFor[reason](),
      createdAt: at(),
    };
  });

  const sales: Sale[] = [];
  for (let index = 0; index < 40; index += 1) {
    const recorded = sale(`s-${index}`, 1 + Math.floor(random() * 3), at(), {
      status: random() < 0.15 ? "voided" : "completed",
    });
    recorded.lines = recorded.lines.map((line) => ({
      ...line,
      productId: pick(productIds),
    }));
    sales.push(recorded);
    if (recorded.status === "completed" && random() < 0.2) {
      sales.push({
        ...recorded,
        id: `r-${index}`,
        createdAt: new Date(
          Date.parse(recorded.createdAt) + Math.floor(random() * 5) * HOUR_MS
        ).toISOString(),
        status: "refunded",
        refundOfSaleId: recorded.id,
      });
    }
  }

  return { productIds, movements, sales };
}

/**
 * The opening the server computes (getInventorySnapshotForTenant): the stock
 * from the rows before `asOf` alone, with each product's latest `initial`
 * among them.
 */
function openingOf(
  ledger: ReturnType<typeof randomLedger>,
  asOf: string
): OpeningStock {
  const before = (createdAt: string) =>
    Date.parse(createdAt) < Date.parse(asOf);
  const movements = ledger.movements.filter((row) => before(row.createdAt));
  const stock = computeStockByProduct(
    movements,
    ledger.sales.filter((row) => before(row.createdAt))
  );
  return {
    asOf,
    levels: ledger.productIds.map((productId) => {
      const baseline = movements
        .filter(
          (row) => row.productId === productId && row.reason === "initial"
        )
        .sort(
          (a, b) =>
            Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
            (b.id > a.id ? 1 : -1)
        )[0];
      return {
        productId,
        units: stock.get(productId) ?? 0,
        baseline: baseline
          ? { id: baseline.id, createdAt: baseline.createdAt }
          : null,
      };
    }),
  };
}

test("an opening plus the rows after it gives the stock of the whole ledger", () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const ledger = randomLedger(seed);
    const whole = computeStockByProduct(ledger.movements, ledger.sales);
    const asOf = new Date(
      LEDGER_START + (seed % 42) * HOUR_MS - (seed % 2)
    ).toISOString();
    const after = (createdAt: string) =>
      Date.parse(createdAt) >= Date.parse(asOf);

    // Rows before the opening may be passed too (the whole local ledger
    // after the first sync): the opening already counts them.
    for (const rows of [
      {
        movements: ledger.movements.filter((row) => after(row.createdAt)),
        sales: ledger.sales.filter((row) => after(row.createdAt)),
      },
      ledger,
    ]) {
      const split = computeStockByProduct(
        rows.movements,
        rows.sales,
        openingOf(ledger, asOf)
      );
      for (const productId of ledger.productIds) {
        assert.equal(
          split.get(productId) ?? 0,
          whole.get(productId) ?? 0,
          `seed ${seed}, ${productId}`
        );
      }
    }
  }
});

test("a count after the opening replaces it", () => {
  const opening: OpeningStock = {
    asOf: "2026-09-10T00:00:00.000Z",
    levels: [
      {
        productId: PRODUCT,
        units: 12,
        baseline: { id: "m0", createdAt: "2026-09-01T10:00:00.000Z" },
      },
    ],
  };

  assert.equal(
    computeStockByProduct(
      [movement("m1", "restock", 3, "2026-09-11T10:00:00.000Z")],
      [sale("s1", 2, "2026-09-12T10:00:00.000Z")],
      opening
    ).get(PRODUCT),
    12 + 3 - 2
  );
  assert.equal(
    computeStockByProduct(
      [
        movement("m1", "restock", 3, "2026-09-11T10:00:00.000Z"),
        movement("m2", "initial", 5, "2026-09-11T12:00:00.000Z"),
      ],
      [sale("s1", 2, "2026-09-12T10:00:00.000Z")],
      opening
    ).get(PRODUCT),
    5 - 2
  );
  assert.equal(
    computeStockByProduct([], [], {
      ...opening,
      levels: [{ ...opening.levels[0], baseline: null }],
    }).get(PRODUCT),
    12
  );
});

test("an initial count in the opening or after it is found", () => {
  const opening: OpeningStock = {
    asOf: "2026-09-10T00:00:00.000Z",
    levels: [
      {
        productId: "counted",
        units: 4,
        baseline: { id: "m0", createdAt: "2026-09-01T10:00:00.000Z" },
      },
      { productId: "restocked", units: 9, baseline: null },
    ],
  };
  const movements = [
    { productId: "counted-later", reason: "initial" as const },
    { productId: "restocked", reason: "restock" as const },
  ];

  assert.equal(productHasInitialMovement("counted", movements, opening), true);
  assert.equal(
    productHasInitialMovement("counted-later", movements, opening),
    true
  );
  assert.equal(
    productHasInitialMovement("restocked", movements, opening),
    false
  );
  assert.equal(productHasInitialMovement("counted", movements), false);
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
