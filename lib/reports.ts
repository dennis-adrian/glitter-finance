import { BOLIVIA_TIME_ZONE, type SalesRangeBounds } from "@/lib/dates";
import { computeMetrics } from "@/lib/sales";
import type { ReportRange, Sale } from "@/lib/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function filterByBounds<T extends { createdAt: string }>(
  records: T[],
  bounds: SalesRangeBounds
) {
  return records.filter((record) => {
    const createdAt = new Date(record.createdAt).getTime();
    return (
      !Number.isNaN(createdAt) &&
      createdAt >= bounds.start &&
      createdAt < bounds.end
    );
  });
}

/**
 * The window to compare against, covering the same elapsed time so a
 * partial day or week isn't compared with a complete one:
 * - today: yesterday up to this hour ("vs. ayer")
 * - week: last week up to the same weekday/hour ("vs. semana pasada")
 * - month/custom: the equally long window right before ("vs. período anterior")
 */
export function comparisonWindow(
  range: ReportRange,
  bounds: SalesRangeBounds,
  now: number
): { bounds: SalesRangeBounds; label: string } {
  const end = Math.min(bounds.end, Math.max(now, bounds.start));
  const elapsed = end - bounds.start;

  if (range === "today" || range === "week") {
    const shift = range === "today" ? DAY_MS : 7 * DAY_MS;
    return {
      bounds: {
        start: bounds.start - shift,
        end: bounds.start - shift + elapsed,
      },
      label: range === "today" ? "vs. ayer" : "vs. semana pasada",
    };
  }

  return {
    bounds: { start: bounds.start - elapsed, end: bounds.start },
    label: "vs. período anterior",
  };
}

/** Percent change, or null when there's nothing to compare against. */
export function percentChange(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export type TrendBucket = {
  key: string;
  /** Axis label ("14 h", "lun 21", "21 sep"). */
  label: string;
  /** Tooltip label ("14:00–15:00", "lunes 21 de septiembre"). */
  title: string;
  netCents: number;
  count: number;
};

const hourFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: BOLIVIA_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});
const dayAxisFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: BOLIVIA_TIME_ZONE,
  day: "numeric",
  month: "short",
});
const weekdayAxisFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: BOLIVIA_TIME_ZONE,
  weekday: "short",
  day: "numeric",
});
const dayTitleFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: BOLIVIA_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

function boliviaHour(time: number) {
  return Number(hourFormatter.format(new Date(time)));
}

export type TrendGranularity = "hour" | "day" | "week";

/** Days from the range start to today (or the range end, if earlier). */
function elapsedDays(bounds: SalesRangeBounds, now: number) {
  const end = Math.min(bounds.end, Math.max(now, bounds.start + HOUR_MS));
  return Math.max(1, Math.ceil((end - bounds.start) / DAY_MS));
}

/**
 * Bucket size for the trend chart: hours for single-day ranges, days up to
 * ~2 months, weeks beyond that.
 */
export function trendGranularity(
  bounds: SalesRangeBounds,
  now: number
): TrendGranularity {
  const days = Math.max(1, Math.round((bounds.end - bounds.start) / DAY_MS));
  if (days === 1) return "hour";
  return elapsedDays(bounds, now) > 62 ? "week" : "day";
}

/**
 * Net revenue per trendGranularity bucket for the trend chart. Day and week
 * buckets run from the range start to today; hourly buckets span business
 * hours (08–20) widened to include every sale.
 */
export function buildTrendBuckets(
  sales: Sale[],
  bounds: SalesRangeBounds,
  now: number
): TrendBucket[] {
  const granularity = trendGranularity(bounds, now);

  if (granularity === "hour") {
    const hours = sales.map((sale) =>
      boliviaHour(new Date(sale.createdAt).getTime())
    );
    const first = Math.min(8, ...hours);
    const last = Math.max(20, ...hours);
    return Array.from({ length: last - first + 1 }, (_, index) => {
      const hour = first + index;
      const start = bounds.start + hour * HOUR_MS;
      const metrics = computeMetrics(
        filterByBounds(sales, { start, end: start + HOUR_MS })
      );
      return {
        key: String(hour),
        label: `${hour} h`,
        title: `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`,
        netCents: metrics.netRevenueCents,
        count: metrics.transactionCount,
      };
    });
  }

  const dayCount = elapsedDays(bounds, now);
  const step = granularity === "week" ? 7 : 1;
  const axis = dayCount <= 7 ? weekdayAxisFormatter : dayAxisFormatter;
  return Array.from({ length: Math.ceil(dayCount / step) }, (_, index) => {
    const start = bounds.start + index * step * DAY_MS;
    const metrics = computeMetrics(
      filterByBounds(sales, { start, end: start + step * DAY_MS })
    );
    // Format at midday so the label is always the bucket's calendar day.
    const labelDate = new Date(start + DAY_MS / 2);
    const day = dayTitleFormatter.format(labelDate);
    return {
      key: String(start),
      label: axis.format(labelDate).replace(".", ""),
      title: step === 1 ? day : `Semana del ${day}`,
      netCents: metrics.netRevenueCents,
      count: metrics.transactionCount,
    };
  });
}
