import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: string;
  tone?: "green";
  warning?: boolean;
};

export function MetricCard({ label, value, tone, warning }: MetricCardProps) {
  return (
    <article className="rounded-2xl bg-card p-3.5 ring-1 ring-foreground/10">
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong
        className={cn(
          "mt-1 block text-2xl font-bold tabular-nums",
          tone === "green" && "text-[var(--green)]"
        )}
      >
        {value}
      </strong>
      {warning ? (
        <small className="text-xs text-[var(--amber)]">Incompleto</small>
      ) : null}
    </article>
  );
}
