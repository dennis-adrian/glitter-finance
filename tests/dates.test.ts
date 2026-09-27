import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSalesByRange,
  formatDateTimeInBolivia,
  resolveSalesRange,
} from "@/lib/dates";

test("today uses Bolivia midnight rather than the device timezone", () => {
  const now = new Date("2026-08-09T05:00:00.000Z");
  const resolution = resolveSalesRange("today", "", "", now);

  assert.deepEqual(resolution, {
    bounds: {
      start: Date.parse("2026-08-09T00:00:00-04:00"),
      end: Date.parse("2026-08-10T00:00:00-04:00"),
    },
    error: null,
  });

  const records = [
    { createdAt: "2026-08-09T03:59:59.999Z", id: "previous-day" },
    { createdAt: "2026-08-09T04:00:00.000Z", id: "start" },
    { createdAt: "2026-08-10T03:59:59.999Z", id: "end" },
    { createdAt: "2026-08-10T04:00:00.000Z", id: "next-day" },
  ];

  assert.deepEqual(
    filterSalesByRange(records, "today", "", "", now).map(
      (record) => record.id
    ),
    ["start", "end"]
  );
});

test("week starts on Monday in Bolivia", () => {
  const resolution = resolveSalesRange(
    "week",
    "",
    "",
    new Date("2026-08-09T17:00:00.000Z")
  );

  assert.deepEqual(resolution, {
    bounds: {
      start: Date.parse("2026-08-03T00:00:00-04:00"),
      end: Date.parse("2026-08-10T00:00:00-04:00"),
    },
    error: null,
  });
});

test("custom ranges include both Bolivia calendar dates and reject reversal", () => {
  const inclusive = resolveSalesRange("custom", "2026-07-31", "2026-08-01");

  assert.deepEqual(inclusive, {
    bounds: {
      start: Date.parse("2026-07-31T00:00:00-04:00"),
      end: Date.parse("2026-08-02T00:00:00-04:00"),
    },
    error: null,
  });
  assert.deepEqual(resolveSalesRange("custom", "2026-08-02", "2026-08-01"), {
    bounds: null,
    error: "La fecha final debe ser igual o posterior a la inicial.",
  });
});

test("timestamps are shown in Bolivian local time", () => {
  const formatted = formatDateTimeInBolivia("2026-09-27T03:05:09.000Z");
  // 03:05 UTC is 23:05 of the previous day in La Paz.
  assert.match(formatted, /^26\/9\/26/);
  assert.match(formatted, /11:05:09/);
  assert.equal(
    formatDateTimeInBolivia(new Date("2026-09-27T03:05:09.000Z")),
    formatted
  );
  assert.equal(formatDateTimeInBolivia("not a date"), "—");
});
