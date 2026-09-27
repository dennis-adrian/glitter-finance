import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import { BrandMark } from "@/components/atoms/brand-mark";
import { SyncStatusPill } from "@/components/molecules/sync-status-pill";
import { screenGutterClass } from "@/components/templates/screen";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScreenHeaderProps = {
  title: ReactNode;
  /** Shows a back (or close) button before the title. */
  onBack?: () => void;
  backIcon?: "back" | "close";
  backLabel?: string;
  /** Buttons aligned to the end of the title row. */
  actions?: ReactNode;
  /**
   * Replaces the visible title (e.g. a search field). The title stays in an
   * sr-only heading for screen readers.
   */
  center?: ReactNode;
  /** Extra rows under the title (search, filters). */
  children?: ReactNode;
  /** Hide the phone sync pill (e.g. a pane inside a split view). */
  hideSync?: boolean;
  className?: string;
};

/**
 * Screen title bar. Titles are left-aligned so actions and the phone sync
 * pill fit on the same row. Top-level phone screens show the brand mark;
 * tablets and desktops already show it in the side navigation.
 */
export function ScreenHeader({
  title,
  onBack,
  backIcon = "back",
  backLabel = "Volver",
  actions,
  center,
  children,
  hideSync = false,
  className,
}: ScreenHeaderProps) {
  const BackIcon = backIcon === "close" ? X : ChevronLeft;

  return (
    <header className={cn(screenGutterClass, className)}>
      <div className="flex h-14 items-center gap-2.5">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={backLabel}
            className="-ml-1 bg-muted hover:bg-muted/70"
          >
            <BackIcon className="size-5" />
          </Button>
        ) : (
          <span className="md:hidden">
            <BrandMark size="small" />
          </span>
        )}
        {center ? (
          <>
            <h1 className="sr-only">{title}</h1>
            <div className="min-w-0 flex-1">{center}</div>
          </>
        ) : (
          <h1 className="min-w-0 flex-1 truncate font-heading text-xl font-extrabold text-primary">
            {title}
          </h1>
        )}
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
        {hideSync ? null : (
          // Wrapped: .sync-pill sets `display` outside Tailwind's layers.
          <span className="contents md:hidden">
            <SyncStatusPill />
          </span>
        )}
      </div>
      {children}
    </header>
  );
}
