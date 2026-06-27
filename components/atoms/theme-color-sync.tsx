"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

const THEME_COLORS = {
  light: "#ffffff",
  dark: "#252422",
} as const;

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;

    const color =
      resolvedTheme === "dark" ? THEME_COLORS.dark : THEME_COLORS.light;

    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", color);
      meta.removeAttribute("media");
    }
  }, [resolvedTheme]);

  return null;
}
