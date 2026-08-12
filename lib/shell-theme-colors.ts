/** Matches `--bg` in app/globals.css (`:root` / `.dark`). */
export const SHELL_THEME_COLORS = {
  light: "#fffdf8",
  dark: "#1a1a1a",
} as const;

/** Resolves install / splash chrome from `Sec-CH-Prefers-Color-Scheme`. */
export function shellThemeColorForScheme(prefersDark: boolean) {
  return prefersDark ? SHELL_THEME_COLORS.dark : SHELL_THEME_COLORS.light;
}
