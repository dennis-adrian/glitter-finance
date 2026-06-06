import { formatBs } from "@/lib/money";

type BarRowProps = {
  label: string;
  value: number;
  max: number;
};

export function BarRow({ label, value, max }: BarRowProps) {
  const width = max ? Math.max(8, Math.round((value / max) * 100)) : 0;

  return (
    <div className="bar-row">
      <div>
        <span>{label}</span>
        <b>{formatBs(value, true)}</b>
      </div>
      <span className="track">
        <i style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}
