"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  /** `null` renders with nothing selected (an explicit choice is required). */
  value: T | null;
  onChange: (value: T) => void;
  "aria-label": string;
  size?: "default" | "sm";
  className?: string;
};

/**
 * Full-width pill segmented control (radio group). Arrow keys move the
 * selection, matching native radio behavior.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  size = "default",
  className,
}: SegmentedControlProps<T>) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    buttonsRef.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-muted p-1",
        className
      )}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        const focusable = selected || (selectedIndex === -1 && index === 0);
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonsRef.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={focusable ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex min-w-0 items-center justify-center gap-2 rounded-full px-3 font-bold whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4.5 [&_svg]:shrink-0",
              size === "sm" ? "min-h-9 text-[13px]" : "min-h-11 text-sm",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
