import clsx from "clsx";

type MetricCardProps = {
  label: string;
  value: string;
  tone?: "green";
  warning?: boolean;
};

export function MetricCard({ label, value, tone, warning }: MetricCardProps) {
  return (
    <article className={clsx("metric-card", tone)}>
      <span>{label}</span>
      <strong>{value}</strong>
      {warning ? <small>Incompleto</small> : null}
    </article>
  );
}
