"use client";

import { SHELL_THEME_COLORS } from "@/lib/shell-theme-colors";
import { useTheme } from "@wrksz/themes/client";
import { useEffect } from "react";

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;

    const color =
      resolvedTheme === "dark"
        ? SHELL_THEME_COLORS.dark
        : SHELL_THEME_COLORS.light;

    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", color);
      meta.removeAttribute("media");
    }
  }, [resolvedTheme]);

  return null;
}
