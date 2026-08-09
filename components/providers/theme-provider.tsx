import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "@wrksz/themes/next";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="glitter-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
