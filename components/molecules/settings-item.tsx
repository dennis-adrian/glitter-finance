import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type SettingsItemProps = {
  icon: ReactNode;
  label: string;
  value: string;
};

export function SettingsItem({ icon, label, value }: SettingsItemProps) {
  return (
    <article className="settings-item">
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
      <ChevronRight size={20} />
    </article>
  );
}
