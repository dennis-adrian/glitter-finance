import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type LocalDataPanelProps = {
  /** Use the parent card instead of a page shell. */
  layout: "page" | "parent";
  tone: "status" | "alert";
  message: string;
  detail?: string;
  /** Recovery actions. */
  children?: ReactNode;
};

/**
 * What PowerSyncProvider renders instead of the app while the local data is
 * being prepared, cleared or recovered.
 */
export function LocalDataPanel({
  layout,
  tone,
  message,
  detail,
  children,
}: LocalDataPanelProps) {
  return (
    <div
      className={
        layout === "parent"
          ? "grid w-full place-items-center py-4"
          : "grid min-h-dvh place-items-center p-6"
      }
      role={tone}
      aria-live={tone === "alert" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <section
        className={
          layout === "parent"
            ? "w-full text-center"
            : "w-full max-w-sm rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10"
        }
      >
        <p className="text-sm text-muted-foreground">{message}</p>
        {detail ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {detail}
          </p>
        ) : null}
        {children ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {children}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function LocalDataPanelButton({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-60",
        variant === "primary"
          ? "bg-primary text-primary-foreground"
          : "text-primary ring-1 ring-primary/30",
        className
      )}
      {...props}
    />
  );
}
