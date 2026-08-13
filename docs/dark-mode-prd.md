# Glitter Finance — Dark Mode PRD

**Author:** Adrian Guzman (with Claude)
**Status:** Draft v1
**Date:** June 2026
**Related:** [glitter-finance-prd.md](./glitter-finance-prd.md) §12.1 (stack), §13 (UI approach)

---

## 1. Overview

Glitter Finance should support a dark appearance. The app follows the device's
system theme by default and lets the vendor override it (Light / Dark / System)
from a toggle in Settings. The choice is remembered on the device and applied
instantly on every launch, with no flash of the wrong theme.

Dark mode matters for a festival POS specifically: vendors work long days that
run into the evening in dimly lit convention halls, often glancing at the phone
between customers. A dark UI is easier on the eyes in those conditions and uses
less battery on OLED phones.

## 2. Goals and Non-Goals

**Goals**

- Render every screen correctly in both light and dark, using the existing
  shadcn token system so components adapt automatically.
- Default to the device's `prefers-color-scheme`, and react live when the OS
  theme changes while the app is open (when the user hasn't set an override).
- Let the vendor choose **Sistema / Claro / Oscuro** from Settings; remember the
  choice per device (works offline).
- No flash of incorrect theme (FOUC) on load, including installed-PWA cold
  starts on iOS Safari and Android Chrome.
- Keep the PWA status-bar / `theme-color` in sync with the active theme.

**Non-Goals**

- No per-account/synced theme preference (it's device-local for now; syncing it
  across a user's devices is a future refinement).
- No scheduled/automatic switching by time of day (only OS-driven + manual).
- No new color palette design. We use the dark tokens already present in
  `app/globals.css`, tuning only where required for contrast/legibility.
- Light-mode brand tokens follow the current Figma palette; dark-mode brand
  tokens stay unchanged until the dedicated dark-mode pass (see §9).

## 3. User Stories

1. As a vendor whose phone is in dark mode, I want the app to open dark, so it
   matches the rest of my device without me configuring anything.
2. As a vendor, I want to force Light or Dark regardless of my phone setting, so
   I can pick what's readable under the booth lighting.
3. As a vendor, I want my choice remembered, so I don't reset it every time I
   open the app at the next event.
4. As a vendor, I want the switch to take effect immediately and never flash a
   bright screen in a dark hall.

## 4. Current State (Analysis)

### 4.1 Implemented

**Tokens and utilities**

- **Dark tokens are defined.** `app/globals.css` has a `.dark { … }` block
  overriding the shadcn semantic tokens (`--background`, `--foreground`,
  `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`,
  `--destructive`, `--border`, `--input`, `--ring`, charts, sidebar) and the
  bespoke vars (`--bg`, `--ink`, `--hairline`, `--shadow`, `--soft-shadow`,
  `--green`, `--amber`, `--danger`, `--amber-surface`).
- **The dark variant is wired for utilities.** `@custom-variant dark (&:is(.dark,
.dark *))` means any `dark:` Tailwind utility activates under a `.dark`
  ancestor, and `@theme inline` maps the tokens to `--color-*`. Components built
  on semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`,
  `bg-primary`, `ring-foreground/10`, …) flip automatically when `.dark` is
  present on `<html>`.

**Theme plumbing (`@wrksz/themes` → `.dark` on `<html>`)**

- **`@wrksz/themes` is installed** (`package.json`).
- **`ThemeProvider`** (`components/providers/theme-provider.tsx`) wraps the app
  with `attribute="class"`, `defaultTheme="system"`, `enableSystem`,
  `storageKey="glitter-theme"`, and `disableTransitionOnChange`. It injects the
  standard pre-paint inline script so the stored mode (or system preference) is
  applied before first paint — no FOUC on cold PWA starts.
- **`app/layout.tsx`** nests `<ThemeProvider>` around `SerwistClientProvider` and
  sets `suppressHydrationWarning` on `<html>` (required because the pre-paint
  script mutates the class before React hydrates).
- **Settings toggle is live.** `settings-screen.tsx` → "Apariencia" section uses
  `ThemePicker` (`components/molecules/theme-picker.tsx`): Sistema / Claro /
  Oscuro segmented control calling `setTheme()`.

**PWA `theme-color`**

- **`app/layout.tsx` `viewport.themeColor`** exports a media-query pair from
  `SHELL_THEME_COLORS` (`lib/shell-theme-colors.ts`) — light and dark surface
  colors aligned with each mode's `--bg` (not the brand teal; see §9).
- **`ThemeColorSync`** (`components/atoms/theme-color-sync.tsx`) reads
  `resolvedTheme` from `@wrksz/themes` and overrides every
  `<meta name="theme-color">` when the user forces Claro/Oscuro against the OS
  (§5.6). Mounted in `app/layout.tsx` inside `ThemeProvider`.
- **`app/manifest.webmanifest/route.ts`** — `theme_color` and `background_color`
  come from `SHELL_THEME_COLORS`; light install/splash chrome uses `#fffdf8`.

**Style gaps already closed**

- `html` / `body` backgrounds are token-driven (`var(--bg)`, `var(--foreground)`):
  light uses the solid `#fffdf8` Figma surface and dark uses the solid
  `#1a1a1a` background.
- Product editor `.image-uploader` / `.edit-fab` use semantic tokens (`--muted`,
  `--border`, `--card`), not hardcoded light hex.
- Amber "cost incomplete" boxes in `reports-screen.tsx` and
  `sale-detail-screen.tsx` use `var(--amber-surface)`, which has a `.dark`
  override in `globals.css`.

**Already fine in both modes (dark-on-dark by design):** the `Toast`
(`bg-[#17151d]`/`#31234c`/`bg-destructive`) and the `.sync-pill` translucent
dark pill. The `.product-art` gradient placeholders are decorative and read
acceptably on either background (verify in audit, don't redesign).

### 4.2 Remaining gaps

See §6 for work items; summary of what's still open:

- **Full dual-platform audit** — walk every screen in both modes on iOS Safari
  PWA and Android Chrome PWA; grep for stranded hardcoded colors (§6.5).
- **Optional header quick-toggle** — not built; Settings-only for v1 (§10.1).

## 5. Functional Requirements

### 5.1 Theme modes

Three user-selectable modes:

- **Sistema (default):** follow `prefers-color-scheme`.
- **Claro:** force light.
- **Oscuro:** force dark.

"Resolved theme" = the actual light/dark applied. In Sistema mode it tracks the
OS; in Claro/Oscuro it's fixed.

### 5.2 System detection and live updates

- On load, if the mode is Sistema, resolve from
  `window.matchMedia('(prefers-color-scheme: dark)')`.
- While the app is open in Sistema mode, subscribe to that media query and
  re-resolve when the OS theme changes (no reload).
- In Claro/Oscuro, ignore OS changes.

### 5.3 Persistence

- Store the selected **mode** (`system | light | dark`) in `localStorage`
  (offline-safe; no network, no PowerSync row). Key e.g. `glitter-theme`.
- Restored on every launch before first paint (§5.4).
- Device-local by design; not synced across devices (future: §11).

### 5.4 No flash (FOUC)

- A tiny blocking inline script in `<head>` reads the stored mode (falling back
  to system) and sets `class="dark"` (or removes it) on `<html>` **before first
  paint**. This is the standard pattern and what `@wrksz/themes` injects.
- `<html>` gets `suppressHydrationWarning` because the script mutates it before
  hydration.
- Acceptance: cold-starting the installed PWA in dark mode shows no white flash
  on iOS Safari or Android Chrome.

### 5.5 Toggle UI

- **Primary location: Settings → "Apariencia"** section, above or near the
  account/team sections in `settings-screen.tsx`.
- **Control:** a 3-way segmented control labelled **Sistema / Claro / Oscuro**
  (icons: `Monitor` / `Sun` / `Moon` from lucide). Selecting applies instantly.
- Built from shadcn primitives (e.g. a small segmented group of `Button`s, or a
  `ToggleGroup` if we add it). Meets the 56px-friendly touch sizing already in
  the Button scale.
- **Optional (decide in §10):** a quick Sun/Moon icon toggle in screen headers
  for one-tap switching without opening Settings. If included, it toggles
  between light/dark and implicitly leaves Sistema.

### 5.6 PWA theme-color / status bar

- Keep the browser/PWA status bar coherent with the active theme. Provide a
  light and dark `theme-color` and switch with the resolved theme. Two options:
  - Static `<meta name="theme-color" media="(prefers-color-scheme: …)">` pair
    (covers Sistema automatically), **plus** a small effect that overrides
    `theme-color` when the user forces Claro/Oscuro against the OS.
  - Or fully manage `theme-color` from the theme provider via `resolvedTheme`.
- Values should match each mode's `--background` surface (not the brand color).

## 6. Token & Style Work (the real surface area)

Plumbing (§7), Settings toggle (§5.5), and runtime `theme-color` (§5.6) are
implemented — see §4.1. Remaining work is in §4.2:

1. ~~**Add dark overrides for bespoke vars**~~ — done in `app/globals.css` `.dark`
   block (§4.1).
2. ~~**Make `html` / `body` backgrounds theme-aware**~~ — done (§4.1).
3. ~~**Product editor** `.image-uploader` / `.edit-fab`~~ — done (§4.1).
4. ~~**Amber warning boxes**~~ — done via `--amber-surface` (§4.1).
5. **Audit pass:** grep for `#`, `rgb(`, `bg-[`, `text-[var(--green|amber)`,
   `var(--ink)` across `components/` and `app/` and confirm each reads correctly
   in dark. Decorative `.product-art` gradients and the intentionally-dark Toast
   / sync-pill are expected to stay.
6. **`manifest.webmanifest` install chrome** — align `theme_color` /
   `background_color` with per-mode surfaces (runtime `theme-color` is already
   handled by `app/layout.tsx` + `ThemeColorSync`; see §4.1).

## 7. Technical Approach

**Implemented with `@wrksz/themes`** (shadcn-canonical, ~2KB, fully offline). See
§4.1 for the wired setup:

- `ThemeProvider` (`components/providers/theme-provider.tsx`) — `attribute="class"`,
  `defaultTheme="system"`, `enableSystem`, `storageKey="glitter-theme"`,
  `disableTransitionOnChange`.
- `app/layout.tsx` — `suppressHydrationWarning` on `<html>`; `ThemeProvider` wraps
  `SerwistClientProvider`; `ThemeColorSync` syncs `theme-color` from
  `resolvedTheme`.
- Settings `ThemePicker` calls `setTheme(mode)`.

The pre-paint no-flash script, `localStorage` persistence, cross-tab sync, live
`matchMedia` updates, and `useTheme()` (`theme` + `resolvedTheme` + `setTheme`) all
come from `@wrksz/themes` as planned.

## 8. Implementation Plan

1. ~~**Plumbing:** install `@wrksz/themes`; add `ThemeProvider`; wrap in layout;
   `suppressHydrationWarning`; verify class toggles and persists. No flash.~~ ✓
   (§4.1)
2. ~~**Token gaps:** dark overrides for bespoke vars; theme-aware `html`/`body`;
   editor uploader; amber boxes.~~ ✓ (§4.1)
3. ~~**Settings control:** "Apariencia" segmented control (Sistema/Claro/Oscuro).~~ ✓
   (§4.1)
4. ~~**PWA `theme-color` runtime sync.**~~ ✓ (`app/layout.tsx` media-query pair +
   `ThemeColorSync`; §4.1)
5. **Audit + dual-platform pass:** walk every screen in both modes on iOS Safari
   PWA and Android Chrome PWA; fix contrast issues. (§4.2, §6.5)
6. **`manifest.webmanifest` install chrome** — per-mode `theme_color` /
   `background_color`. (§4.2, §6.6)
7. _(Optional)_ header quick-toggle, if chosen in §10.

## 9. Primary Color Note (cross-reference)

The current shadcn brand tokens are:

- **Light primary:** `#00786f` — teal.
- **Light secondary:** `#e8725a` — coral.
- **Dark primary:** `#009e91` — brighter teal.
- **Dark secondary:** `#fa8272` — brighter coral.
- **Dark surfaces:** background `#1a1a1a`, card/panel `#242424`, muted
  `#2e2e2e`, border `#3a3a3a`.
- **Dark text:** foreground `#e8e6e3`, muted `#9a9896`.

Two related observations:

- Brand purple and crimson have been superseded app-wide by the teal above for
  `--primary` and app icons. PWA shell chrome is separate: `app/layout.tsx`
  `viewport.themeColor` and `manifest.webmanifest` `theme_color` use neutral
  per-mode surface colors from `SHELL_THEME_COLORS` (aligned with each mode's
  `--bg`), not the brand teal; `ThemeColorSync` overrides `theme-color` when the
  user forces Claro/Oscuro against the OS (§5.6). The page surfaces are the
  solid Figma backgrounds `#fffdf8` (light) and `#1a1a1a` (dark).
- The original product PRD still names the brand as `#6822E2` (purple); that is
  now superseded by the teal `--primary` going forward. The decorative
  `product-art` tone palette (incl. the per-product `violet`/`aurora` tones) and
  the near-navy toast "info" background are intentionally left as-is.

## 10. Open Questions / Decisions

1. **Header quick-toggle?** Settings-only (simplest), or also a Sun/Moon in
   headers for one-tap switching? (Recommend: Settings-only for v1; current
   build is Settings-only.)
2. **Default when no OS signal / first run:** Sistema (recommended; implemented
   via `defaultTheme="system"`).
3. ~~**`theme-color` strategy:**~~ Resolved — provider-managed via
   `ThemeColorSync` + media-query fallback in `app/layout.tsx` (§4.1).
4. ~~**Dependency:**~~ Resolved — `@wrksz/themes` in use (§4.1).
5. **Tune dark accent values** (`--green`/`--amber`) now, or only if the audit
   shows contrast failures?

## 11. Out of Scope / Future

- Account-level synced theme preference across a user's devices.
- Time-/sunset-scheduled automatic switching.
- A full dark-mode visual redesign or a separate dark brand palette.
- Per-screen or per-component theme exceptions.

## 12. Acceptance Criteria

- Fresh install on a dark-set phone opens in dark with **no white flash** (iOS
  Safari PWA + Android Chrome PWA).
- Toggling Sistema/Claro/Oscuro in Settings applies instantly and persists
  across full app restarts.
- In Sistema mode, changing the OS theme while the app is open updates the app
  live.
- Every screen (Sell, Cart, Payment, Catalog, Product Editor, Reports, Sale
  Detail, Settings, Diagnostics, Login, Offline) is legible in both modes — no
  light-on-light or dark-on-dark text, no stranded light/cream panels.
- The PWA status bar / `theme-color` matches the active theme.

---

_End of document._
