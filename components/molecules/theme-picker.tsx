"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@wrksz/themes/client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "Sistema", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
] as const;

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="grid h-14 grid-cols-3 gap-2" aria-hidden />;
  }

  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="group"
      aria-label="Apariencia"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;

        return (
          <Button
            key={value}
            type="button"
            variant={selected ? "default" : "outline"}
            size="lg"
            aria-pressed={selected}
            className={cn(
              "h-14 flex-col gap-1 rounded-2xl px-2 text-xs",
              !selected && "text-muted-foreground"
            )}
            onClick={() => setTheme(value)}
          >
            <Icon className="size-[18px]" aria-hidden />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
