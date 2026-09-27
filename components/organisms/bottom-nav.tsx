import { cn } from "@/lib/utils";
import type { PrimaryView } from "@/lib/views";
import { navItems } from "@/components/organisms/nav-items";

type BottomNavProps = {
  active: PrimaryView;
  onNavigate: (view: PrimaryView) => void;
};

/** Phone navigation (< md). Tablets and desktops use SideNav instead. */
export function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav
      className="grid shrink-0 grid-cols-5 border-t border-border bg-card px-1 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Navegación principal"
    >
      {navItems.map(({ view, label, icon: Icon }) => {
        const isActive = view === active;
        return (
          <button
            key={view}
            type="button"
            onClick={() => onNavigate(view)}
            className={cn(
              "group flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-xs leading-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              isActive
                ? "font-bold text-primary"
                : "font-semibold text-muted-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <span
              className={cn(
                "grid h-7 w-12 place-items-center rounded-full transition-colors",
                isActive ? "bg-primary/12" : "group-hover:bg-muted"
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="max-w-full truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
