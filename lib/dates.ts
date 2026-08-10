import type { ReportRange } from "@/lib/types";

export const BOLIVIA_TIME_ZONE = "America/La_Paz";

const BOLIVIA_UTC_OFFSET = "-04:00";

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type SalesRangeBounds = {
  start: number;
  end: number;
};

export type SalesRangeResolution =
  | { bounds: SalesRangeBounds; error: null }
  | { bounds: null; error: string };

const boliviaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BOLIVIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const boliviaDateLabelFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: BOLIVIA_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function toCalendarDate(value: Date): CalendarDate {
  const parts = boliviaDateFormatter.formatToParts(value);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

function isValidCalendarDate(value: CalendarDate) {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  return (
    date.getUTCFullYear() === value.year &&
    date.getUTCMonth() === value.month - 1 &&
    date.getUTCDate() === value.day
  );
}

function toDateInputValue(value: CalendarDate) {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(
    value.day
  ).padStart(2, "0")}`;
}

function parseDateInput(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const parsed = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };

  return isValidCalendarDate(parsed) ? parsed : null;
}

function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day));
  next.setUTCDate(next.getUTCDate() + days);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function boliviaMidnight(value: CalendarDate) {
  return new Date(
    `${toDateInputValue(value)}T00:00:00${BOLIVIA_UTC_OFFSET}`
  ).getTime();
}

function rangeFromCalendarDates(
  start: CalendarDate,
  end: CalendarDate
): SalesRangeBounds {
  return {
    start: boliviaMidnight(start),
    end: boliviaMidnight(addCalendarDays(end, 1)),
  };
}

export function formatDateInputInBolivia(now = new Date()) {
  return toDateInputValue(toCalendarDate(now));
}

export function formatDateLabelInBolivia(iso: string) {
  return boliviaDateLabelFormatter.format(new Date(iso));
}

export function resolveSalesRange(
  range: ReportRange,
  customStart: string,
  customEnd: string,
  now = new Date()
): SalesRangeResolution {
  if (range === "custom") {
    const start = parseDateInput(customStart);
    const end = parseDateInput(customEnd);

    if (!start || !end) {
      return {
        bounds: null,
        error: "Elige una fecha de inicio y una fecha final.",
      };
    }

    if (toDateInputValue(start) > toDateInputValue(end)) {
      return {
        bounds: null,
        error: "La fecha final debe ser igual o posterior a la inicial.",
      };
    }

    return { bounds: rangeFromCalendarDates(start, end), error: null };
  }

  const today = toCalendarDate(now);

  if (range === "today") {
    return { bounds: rangeFromCalendarDates(today, today), error: null };
  }

  if (range === "week") {
    const dayOfWeek = new Date(
      Date.UTC(today.year, today.month - 1, today.day)
    ).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const start = addCalendarDays(today, -daysSinceMonday);
    return { bounds: rangeFromCalendarDates(start, today), error: null };
  }

  const start = { ...today, day: 1 };
  return { bounds: rangeFromCalendarDates(start, today), error: null };
}

export function filterSalesByRange<T extends { createdAt: string }>(
  sales: T[],
  range: ReportRange,
  customStart: string,
  customEnd: string,
  now = new Date()
) {
  const resolution = resolveSalesRange(range, customStart, customEnd, now);
  if (!resolution.bounds) return [];

  return sales.filter((sale) => {
    const createdAt = new Date(sale.createdAt).getTime();
    return (
      !Number.isNaN(createdAt) &&
      createdAt >= resolution.bounds.start &&
      createdAt < resolution.bounds.end
    );
  });
}

export function relativeTime(iso: string) {
  const minutes = minutesSince(iso);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} hora`;
  return new Intl.DateTimeFormat("es-BO", {
    timeZone: BOLIVIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

export function minutesSince(iso: string, now = Date.now()) {
  return Math.floor((now - new Date(iso).getTime()) / 60000);
}
