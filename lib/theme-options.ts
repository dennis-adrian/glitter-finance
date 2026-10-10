/**
 * Where the Sistema / Claro / Oscuro choice is stored and how the resolved
 * theme reaches the page (the `.dark` class on <html>). Shared by the root
 * layout's ThemeProvider and app/global-error.tsx, which replaces the root
 * layout and that provider with it.
 */
export const THEME_OPTIONS = {
  attribute: "class",
  defaultTheme: "system",
  enableSystem: true,
  disableTransitionOnChange: true,
  storageKey: "glitter-theme",
} as const;
