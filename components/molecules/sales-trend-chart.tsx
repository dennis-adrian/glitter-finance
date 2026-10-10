"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import { APP_LOCALE } from "@/lib/dates";
import { formatBs } from "@/lib/money";
import { countLabel } from "@/lib/plural";
import type { TrendBucket } from "@/lib/reports";

type SalesTrendChartProps = {
  buckets: TrendBucket[];
  /** Describes the chart for screen readers ("Ingreso neto por hora"). */
  title: string;
};

/** Compact Bs ticks: 0, 50, 1,2 mil. */
function formatTick(cents: number) {
  const value = cents / 100;
  if (Math.abs(value) >= 1000) {
    return `${new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
  }
  return new Intl.NumberFormat(APP_LOCALE).format(value);
}

function TrendTooltip({
  active,
  payload,
}: TooltipContentProps<ValueType, NameType>) {
  const bucket = payload?.[0]?.payload as TrendBucket | undefined;
  if (!active || !bucket) return null;

  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-sm text-popover-foreground shadow-[var(--soft-shadow)] ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground first-letter:uppercase">
        {bucket.title}
      </p>
      <p className="font-bold tabular-nums">
        {formatBs(bucket.netCents, true)}
      </p>
      <p className="text-xs text-muted-foreground">
        {countLabel(bucket.count, "venta", "ventas")}
      </p>
    </div>
  );
}

/**
 * Single-series column chart of net revenue over the selected period.
 * One series, so no legend: the section title names it. A visually hidden
 * table carries the same values for screen readers.
 */
export function SalesTrendChart({ buckets, title }: SalesTrendChartProps) {
  return (
    <figure className="m-0 min-w-0">
      <div className="h-52 w-full min-w-0 overflow-hidden md:h-60" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={buckets}
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={12}
              tickMargin={8}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={formatTick}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={TrendTooltip}
              isAnimationActive={false}
            />
            <Bar
              dataKey="netCents"
              fill="var(--primary)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{title}</figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Período</th>
            <th scope="col">Ingreso neto</th>
            <th scope="col">Ventas</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.title}</th>
              <td>{formatBs(bucket.netCents, true)}</td>
              <td>{bucket.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
