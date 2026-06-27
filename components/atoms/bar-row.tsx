import { formatBs } from "@/lib/money";

type BarRowProps = {
  label: string;
  value: number;
  max: number;
};

export function BarRow({ label, value, max }: BarRowProps) {
  const width = max
    ? Math.max(8, Math.round((Math.abs(value) / max) * 100))
    : 0;

  return (
    <div className="mb-3.5 grid gap-1.5 last:mb-0">
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <b className="tabular-nums">{formatBs(value, true)}</b>
      </div>
      <span className="block h-2.5 overflow-hidden rounded-full bg-muted">
        <i
          className="block h-full rounded-full bg-primary"
          style={{ width: `${width}%` }}
        />
      </span>
    </div>
  );
}
