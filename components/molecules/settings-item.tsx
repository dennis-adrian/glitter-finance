import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type SettingsItemProps = {
  icon: ReactNode;
  label: string;
  value: string;
  onClick: () => void;
};

/** A settings row that navigates somewhere (hence the chevron). */
export function SettingsItem({
  icon,
  label,
  value,
  onClick,
}: SettingsItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid min-h-16 w-full grid-cols-[42px_1fr_24px] items-center rounded-2xl bg-card px-3.5 text-left ring-1 ring-foreground/10 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="text-primary">{icon}</span>
      <span>
        <strong className="block text-sm font-semibold">{label}</strong>
        <small className="block text-xs text-muted-foreground">{value}</small>
      </span>
      <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
    </button>
  );
}
