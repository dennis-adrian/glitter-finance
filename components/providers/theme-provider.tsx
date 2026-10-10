import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "@wrksz/themes/next";
import { THEME_OPTIONS } from "@/lib/theme-options";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...THEME_OPTIONS} {...props}>
      {children}
    </NextThemesProvider>
  );
}
