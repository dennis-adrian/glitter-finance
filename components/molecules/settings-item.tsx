import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type SettingsItemProps = {
  icon: ReactNode;
  label: string;
  value: string;
  /** Only for rows that open something; read-only stats have no chevron. */
  showChevron?: boolean;
};

export function SettingsItem({
  icon,
  label,
  value,
  showChevron = false,
}: SettingsItemProps) {
  return (
    <div className="grid min-h-16 grid-cols-[42px_1fr_24px] items-center rounded-2xl bg-card px-3.5 ring-1 ring-foreground/10">
      <span className="text-primary">{icon}</span>
      <div>
        <strong className="block text-sm font-semibold">{label}</strong>
        <small className="block text-xs text-muted-foreground">{value}</small>
      </div>
      {showChevron ? (
        <ChevronRight className="size-5 text-muted-foreground" />
      ) : null}
    </div>
  );
}
