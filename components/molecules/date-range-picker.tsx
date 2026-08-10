"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReportRange } from "@/lib/types";

const ranges: [ReportRange, string][] = [
  ["today", "Hoy"],
  ["week", "Esta semana"],
  ["month", "Este mes"],
  ["custom", "Rango"],
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
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ranges.map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={range === value ? "default" : "outline"}
            className="shrink-0 rounded-full px-4"
            onClick={() => setRange(value)}
          >
            {label}
          </Button>
        ))}
      </div>

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
