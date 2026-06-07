import type { ReportRange } from "@/lib/types";

export function isInsideRange(iso: string, range: ReportRange) {
  const date = new Date(iso);
  const now = new Date();
  const start = new Date(now);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  return date >= start;
}

export function relativeTime(iso: string) {
  const minutes = minutesSince(iso);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} hora`;
  return new Intl.DateTimeFormat("es-BO", {
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

export function minutesSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
