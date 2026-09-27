import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Content widths. Header, body, and footer share one so edges line up. */
export type ScreenWidth = "narrow" | "medium" | "wide" | "full";

export const screenWidthClass: Record<ScreenWidth, string> = {
  narrow: "max-w-2xl",
  medium: "max-w-5xl",
  wide: "max-w-screen-2xl",
  full: "",
};

/** Horizontal gutters used by every screen region. */
export const screenGutterClass = "px-4 md:px-6 lg:px-8";

type ScreenProps = {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: ScreenWidth;
  className?: string;
  bodyClassName?: string;
  /** Accessible name for the screen region (defaults to the header title). */
  "aria-label"?: string;
};

/**
 * Standard screen: a fixed header, one scrolling body, and an optional
 * in-flow footer (checkout bar, save bar). Footers sit in normal flow above
 * the bottom nav, so nothing is positioned with magic pixel offsets.
 */
export function Screen({
  header,
  footer,
  children,
  width = "wide",
  className,
  bodyClassName,
  "aria-label": ariaLabel,
}: ScreenProps) {
  return (
    <section
      className={cn("flex h-full min-h-0 flex-col", className)}
      aria-label={ariaLabel}
    >
      {header ? (
        <div className="shrink-0 border-b border-border/70 bg-background">
          <div className={cn("mx-auto w-full", screenWidthClass[width])}>
            {header}
          </div>
        </div>
      ) : null}
      <div className="scroll-region min-h-0 flex-1">
        <div
          className={cn(
            "mx-auto w-full pt-4 pb-8",
            screenGutterClass,
            screenWidthClass[width],
            bodyClassName
          )}
        >
          {children}
        </div>
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-border bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/85">
          <div
            className={cn(
              "mx-auto w-full py-3",
              screenGutterClass,
              screenWidthClass[width]
            )}
          >
            {footer}
          </div>
        </div>
      ) : null}
    </section>
  );
}
