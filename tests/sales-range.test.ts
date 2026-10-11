import assert from "node:assert/strict";
import test from "node:test";
import {
  listPageLength,
  nextListPage,
  SALES_PAGE_SIZE,
  salesRangeKey,
} from "@/lib/use-sales-range";

test("a range's key changes with the range, and custom dates count only for a custom range", () => {
  assert.equal(
    salesRangeKey({
      range: "week",
      customStart: "2026-10-01",
      customEnd: "2026-10-02",
    }),
    "week"
  );
  assert.equal(
    salesRangeKey({
      range: "custom",
      customStart: "2026-10-01",
      customEnd: "2026-10-02",
    }),
    "custom:2026-10-01:2026-10-02"
  );
  assert.notEqual(
    salesRangeKey({
      range: "custom",
      customStart: "2026-10-01",
      customEnd: "2026-10-03",
    }),
    "custom:2026-10-01:2026-10-02"
  );
});

test("a list's page grows a page at a time and starts over when the range changes", () => {
  assert.equal(listPageLength({ rangeKey: "week", length: 120 }, "week"), 120);
  assert.equal(
    listPageLength({ rangeKey: "week", length: 120 }, "month"),
    SALES_PAGE_SIZE
  );
  assert.deepEqual(nextListPage({ rangeKey: "week", length: 40 }, "week"), {
    rangeKey: "week",
    length: 40 + SALES_PAGE_SIZE,
  });
  assert.deepEqual(nextListPage({ rangeKey: "week", length: 120 }, "month"), {
    rangeKey: "month",
    length: 2 * SALES_PAGE_SIZE,
  });
});
