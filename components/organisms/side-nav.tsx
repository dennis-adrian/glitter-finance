import { BrandMark } from "@/components/atoms/brand-mark";
import { SyncStatusPill } from "@/components/molecules/sync-status-pill";
import { navItems } from "@/components/organisms/nav-items";
import { cn } from "@/lib/utils";
import type { PrimaryView } from "@/lib/views";

type SideNavProps = {
  active: PrimaryView;
  onNavigate: (view: PrimaryView) => void;
  tenantName?: string | null;
};

/**
 * Tablet/desktop navigation: an icon rail from `md`, expanding into a labeled
 * sidebar from `xl`. Hidden on phones, which use BottomNav.
 */
export function SideNav({ active, onNavigate, tenantName }: SideNavProps) {
  return (
    <nav
      className="hidden w-[88px] shrink-0 flex-col border-r border-border bg-card px-2 pt-4 pb-3 md:flex xl:w-60 xl:px-3"
      aria-label="Navegación principal"
    >
      <div className="mb-5 flex flex-col items-center gap-2 xl:flex-row xl:px-2">
        {/* The name below is read instead of the logo: visible from `xl`,
            screen-reader only on the narrow rail. */}
        <BrandMark decorative />
        <div className="sr-only min-w-0 xl:not-sr-only">
          <p className="truncate font-heading text-base leading-tight font-extrabold text-primary">
            Billetera Ferial
          </p>
          {tenantName ? (
            <p className="truncate text-xs text-muted-foreground">
              {tenantName}
            </p>
          ) : null}
        </div>
      </div>

      <ul className="grid gap-1">
        {navItems.map(({ view, label, icon: Icon }) => {
          const isActive = view === active;
          return (
            <li key={view}>
              <button
                type="button"
                onClick={() => onNavigate(view)}
                className={cn(
                  "flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 xl:min-h-11 xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:text-sm",
                  isActive
                    ? "bg-primary/12 font-bold text-primary"
                    : "font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="max-w-full truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex justify-center pt-3 xl:justify-start xl:px-1">
        <SyncStatusPill variant="nav" />
      </div>
    </nav>
  );
}
