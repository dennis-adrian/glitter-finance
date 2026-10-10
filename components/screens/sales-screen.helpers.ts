import {
  formatDateInputInBolivia,
  formatDateLabelInBolivia,
} from "@/lib/dates";
import { computeMetrics, sortSalesNewestFirst } from "@/lib/sales";
import type { Sale } from "@/lib/types";

export type SaleDayGroup = {
  /** The Bolivian calendar date, YYYY-MM-DD. */
  key: string;
  label: string;
  sales: Sale[];
  /** The day's net over all of its sales, however many the list shows. */
  netCents: number;
};

/** The sales by Bolivian calendar day, newest day and sale first. */
export function groupSalesByDay(sales: readonly Sale[]): SaleDayGroup[] {
  const byDay = new Map<string, Sale[]>();
  for (const sale of sortSalesNewestFirst(sales)) {
    const key = formatDateInputInBolivia(new Date(sale.createdAt));
    const daySales = byDay.get(key);
    if (daySales) {
      daySales.push(sale);
    } else {
      byDay.set(key, [sale]);
    }
  }

  return [...byDay].map(([key, daySales]) => ({
    key,
    label: formatDateLabelInBolivia(daySales[0].createdAt),
    sales: daySales,
    netCents: computeMetrics(daySales).netRevenueCents,
  }));
}

/**
 * The first `count` sales, still grouped by day. A day cut short by the page
 * keeps its full net, so its total matches the range's and does not change
 * as more sales load.
 */
export function firstSalesByDay(
  groups: readonly SaleDayGroup[],
  count: number
): SaleDayGroup[] {
  const shown: SaleDayGroup[] = [];
  let remaining = count;
  for (const group of groups) {
    if (remaining <= 0) break;
    shown.push(
      group.sales.length <= remaining
        ? group
        : { ...group, sales: group.sales.slice(0, remaining) }
    );
    remaining -= group.sales.length;
  }
  return shown;
}
