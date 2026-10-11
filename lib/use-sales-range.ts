"use client";

import { useCallback, useMemo, useState } from "react";
import {
  filterSalesByBounds,
  formatDateInputInBolivia,
  resolveSalesRange,
} from "@/lib/dates";
import type { ReportRange } from "@/lib/types";

/** How many more sales each "Ver más ventas" shows. */
export const SALES_PAGE_SIZE = 40;

type SalesRangeValue = {
  range: ReportRange;
  customStart: string;
  customEnd: string;
  /** How many of the range's sales the Sales list shows. */
  salesListLength: number;
};

export type SalesRangeState = SalesRangeValue & {
  setRange: (range: ReportRange) => void;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
  showMoreSales: () => void;
};

function initialSalesRange(): SalesRangeValue {
  const today = formatDateInputInBolivia();
  return {
    range: "today",
    customStart: today,
    customEnd: today,
    salesListLength: SALES_PAGE_SIZE,
  };
}

/**
 * The date range Sales, Reports and a seller's sales filter by, and how far
 * the Sales list is paged. Switching to a custom range starts it at today,
 * and any change of range takes the list back to its first page.
 */
export function useSalesRangeState(): SalesRangeState {
  const [value, setValue] = useState(initialSalesRange);

  const setRange = useCallback((range: ReportRange) => {
    const today = formatDateInputInBolivia();
    setValue((current) =>
      current.range === range
        ? current
        : {
            range,
            customStart: range === "custom" ? today : current.customStart,
            customEnd: range === "custom" ? today : current.customEnd,
            salesListLength: SALES_PAGE_SIZE,
          }
    );
  }, []);
  const setCustomStart = useCallback((customStart: string) => {
    setValue((current) =>
      current.customStart === customStart
        ? current
        : { ...current, customStart, salesListLength: SALES_PAGE_SIZE }
    );
  }, []);
  const setCustomEnd = useCallback((customEnd: string) => {
    setValue((current) =>
      current.customEnd === customEnd
        ? current
        : { ...current, customEnd, salesListLength: SALES_PAGE_SIZE }
    );
  }, []);
  const showMoreSales = useCallback(() => {
    setValue((current) => ({
      ...current,
      salesListLength: current.salesListLength + SALES_PAGE_SIZE,
    }));
  }, []);

  return useMemo(
    () => ({
      ...value,
      setRange,
      setCustomStart,
      setCustomEnd,
      showMoreSales,
    }),
    [value, setRange, setCustomStart, setCustomEnd, showMoreSales]
  );
}

/** A list's page: how many sales it shows, for the range it was paged in. */
export type ListPage = { rangeKey: string; length: number };

/** Names the range for paging: custom dates count only on a custom range. */
export function salesRangeKey({
  range,
  customStart,
  customEnd,
}: Pick<SalesRangeValue, "range" | "customStart" | "customEnd">) {
  return range === "custom" ? `custom:${customStart}:${customEnd}` : range;
}

/** The page's length on `rangeKey`: the first page again once it changed. */
export function listPageLength(page: ListPage, rangeKey: string) {
  return page.rangeKey === rangeKey ? page.length : SALES_PAGE_SIZE;
}

export function nextListPage(page: ListPage, rangeKey: string): ListPage {
  return { rangeKey, length: listPageLength(page, rangeKey) + SALES_PAGE_SIZE };
}

/**
 * A list's own page (a seller's sales), back to the first one whenever the
 * range changes. The Sales list's page lives in SalesRangeState instead.
 */
export function useListPage(rangeKey: string) {
  const [page, setPage] = useState<ListPage>({
    rangeKey,
    length: SALES_PAGE_SIZE,
  });
  const showMore = useCallback(
    () => setPage((current) => nextListPage(current, rangeKey)),
    [rangeKey]
  );
  return { length: listPageLength(page, rangeKey), showMore };
}

/**
 * The sales created within the chosen range at `now`, and why a custom range
 * is invalid. The range resolves on every render, which is cheap, but the
 * sales are filtered again only when they or the range's bounds change (for
 * "Hoy", at midnight), not on every tick of `now`.
 */
export function useSalesInRange<T extends { createdAt: string }>(
  sales: T[],
  {
    range,
    customStart,
    customEnd,
  }: Pick<SalesRangeValue, "range" | "customStart" | "customEnd">,
  now: number
) {
  const { bounds, error } = resolveSalesRange(
    range,
    customStart,
    customEnd,
    new Date(now)
  );
  const start = bounds?.start;
  const end = bounds?.end;
  const salesInRange = useMemo(
    () =>
      start === undefined || end === undefined
        ? []
        : filterSalesByBounds(sales, { start, end }),
    [sales, start, end]
  );

  return { error, sales: salesInRange };
}
