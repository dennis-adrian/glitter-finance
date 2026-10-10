"use client";

import { SegmentedControl } from "@/components/molecules/segmented-control";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReportRange } from "@/lib/types";

// Short labels so all four fit a 320px phone without horizontal scrolling.
const ranges: { value: ReportRange; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
  { value: "custom", label: "Rango" },
];

type DateRangePickerProps = {
  range: ReportRange;
  customStart: string;
  customEnd: string;
  error?: string | null;
  setRange: (range: ReportRange) => void;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
};

export function DateRangePicker({
  range,
  customStart,
  customEnd,
  error,
  setRange,
  setCustomStart,
  setCustomEnd,
}: DateRangePickerProps) {
  return (
    <>
      <SegmentedControl<ReportRange>
        aria-label="Período"
        size="sm"
        className="mb-4 md:max-w-md"
        options={ranges}
        value={range}
        onChange={setRange}
      />

      {range === "custom" ? (
        <div className="mb-4">
          <div className="grid grid-cols-2 gap-2.5">
            <Label className="grid gap-1.5 text-xs font-bold text-muted-foreground">
              Desde
              <Input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="h-11 rounded-xl"
              />
            </Label>
            <Label className="grid gap-1.5 text-xs font-bold text-muted-foreground">
              Hasta
              <Input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="h-11 rounded-xl"
              />
            </Label>
          </div>
          {error ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
