import type { ReactNode } from "react";

type DetailRowProps = {
  label: string;
  value: ReactNode;
  tone?: "strong" | "muted" | "danger" | "success";
};

export function DetailRow({ label, value, tone = "muted" }: DetailRowProps) {
  return (
    <div className={`detail-row ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
