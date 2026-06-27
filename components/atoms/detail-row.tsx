import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DetailRowProps = {
  label: string;
  value: ReactNode;
  tone?: "strong" | "muted" | "danger" | "success";
};

export function DetailRow({ label, value, tone = "muted" }: DetailRowProps) {
  return (
    <div className="flex min-h-9.5 items-center justify-between gap-3.5 border-b border-border py-1.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong
        className={cn(
          "text-right text-sm",
          tone === "strong" && "text-base text-foreground",
          tone === "success" && "text-[var(--green)]",
          tone === "danger" && "text-destructive"
        )}
      >
        {value}
      </strong>
    </div>
  );
}
