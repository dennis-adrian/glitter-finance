import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

type SettingsLinkItemProps = {
  icon: ReactNode;
  label: string;
  value: string;
  href: string;
};

/**
 * A settings row that leaves the app: a support channel or a legal page. It
 * opens in a new tab (or the system browser, in the installed app), so the
 * app keeps its place, and shows an external-link icon instead of
 * SettingsItem's chevron.
 */
export function SettingsLinkItem({
  icon,
  label,
  value,
  href,
}: SettingsLinkItemProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="grid min-h-16 w-full grid-cols-[42px_1fr_24px] items-center rounded-2xl bg-card px-3.5 text-left ring-1 ring-foreground/10 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="text-primary">{icon}</span>
      <span className="min-w-0">
        <strong className="block text-sm font-semibold">{label}</strong>
        <small className="block truncate text-xs text-muted-foreground">
          {value}
        </small>
      </span>
      <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}
