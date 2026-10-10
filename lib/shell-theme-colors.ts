/**
 * The status bar (`theme-color`) and install chrome for each mode. Matches
 * `--bg` and `--background` in app/globals.css (`:root` / `.dark`), so it
 * blends with every page, the sign-in screens included.
 */
export const SHELL_THEME_COLORS = {
  light: "#fffdf8",
  dark: "#1a1a1a",
} as const;

/** Resolves install / splash chrome from `Sec-CH-Prefers-Color-Scheme`. */
export function shellThemeColorForScheme(prefersDark: boolean) {
  return prefersDark ? SHELL_THEME_COLORS.dark : SHELL_THEME_COLORS.light;
}
