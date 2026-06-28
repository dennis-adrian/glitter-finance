/** Matches `--bg` in app/globals.css (`:root` / `.dark`). */
export const SHELL_THEME_COLORS = {
  light: "#fbfafc",
  dark: "oklch(0.147 0.004 49.25)",
} as const;

/** Resolves install / splash chrome from `Sec-CH-Prefers-Color-Scheme`. */
export function shellThemeColorForScheme(prefersDark: boolean) {
  return prefersDark ? SHELL_THEME_COLORS.dark : SHELL_THEME_COLORS.light;
}
