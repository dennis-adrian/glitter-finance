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
- No changes to the brand `--primary` decision (it stays as-is; see §9).

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

What already exists:

- **Dark tokens are defined.** `app/globals.css` has a `.dark { … }` block
  overriding the shadcn semantic tokens (`--background`, `--foreground`,
  `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`,
  `--destructive`, `--border`, `--input`, `--ring`, charts, sidebar).
- **The dark variant is wired for utilities.** `@custom-variant dark (&:is(.dark
  *))` means any `dark:` Tailwind utility activates under a `.dark` ancestor, and
  `@theme inline` maps the tokens to `--color-*`. So all components built on
  semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`,
  `bg-primary`, `ring-foreground/10`, …) already flip for free.

What's missing or broken for dark:

- **No mechanism to apply `.dark`.** No theme library, no class on `<html>`, no
  persistence, no system-preference detection, no no-flash script. `next-themes`
  is not installed.
- **Bespoke CSS vars are not overridden in `.dark`.** `--bg`, `--ink`,
  `--hairline`, `--shadow`, `--soft-shadow`, `--green`, `--amber`, `--danger`,
  `--primary-2` keep their light values in dark mode.
- **Hardcoded light-only colors won't flip:**
  - `html { background: #eeeaf5 }` — light lavender page backdrop.
  - `body { background: <light purple/white gradient>; color: var(--ink) }` —
    light gradient and dark `--ink` text both stay put.
  - `.image-uploader { background:#f0eef5; border:#d4cfdd }` and `.edit-fab
    { background:#fff }` in the product editor.
  - Amber "cost incomplete" warning boxes use `bg-[#fff8e8]` (a light cream) in
    `reports-screen.tsx` and `sale-detail-screen.tsx`.
- **Already fine in both modes (dark-on-dark by design):** the `Toast`
  (`bg-[#17151d]`/`#31234c`/`bg-destructive`) and the `.sync-pill` translucent
  dark pill. The `.product-art` gradient placeholders are decorative and read
  acceptably on either background (verify, don't redesign).
- **`theme-color` is static.** `app/layout.tsx` sets `viewport.themeColor:
  "#6822E2"`. It doesn't change per mode (and is a stale brand value — see §9).
- **No `suppressHydrationWarning`** on `<html>`, which the pre-paint theme
  script will require (the script mutates the class before React hydrates).

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
  paint**. This is the standard pattern and what `next-themes` injects.
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

Most components already flip via tokens; the work is closing the gaps from §4.

1. **Add dark overrides for bespoke vars** in the `.dark` block of
   `app/globals.css`: `--bg`, `--ink`, `--hairline`, `--shadow`, `--soft-shadow`,
   and tune `--green` / `--amber` / `--danger` / `--primary-2` for dark contrast.
   (Prefer migrating usages onto semantic tokens where reasonable, but keeping
   the bespoke vars and giving them dark values is the lower-risk path.)
2. **Make `html` / `body` backgrounds theme-aware.** Replace the hardcoded
   `#eeeaf5` and the light gradient with token-driven values (or a `.dark`
   override of the gradient). `body` text should use `--foreground` rather than
   the fixed `--ink`.
3. **Product editor**: give `.image-uploader` / `.edit-fab` dark variants (or
   re-express with tokens).
4. **Amber warning boxes**: replace `bg-[#fff8e8]` in `reports-screen.tsx` and
   `sale-detail-screen.tsx` with a token/`dark:` treatment that reads on dark
   (e.g. an amber-tinted surface that has both light and dark variants).
5. **Audit pass**: grep for `#`, `rgb(`, `bg-[`, `text-[var(--green|amber)`,
   `var(--ink)` across `components/` and `app/` and confirm each reads correctly
   in dark. Decorative `.product-art` gradients and the intentionally-dark Toast
   / sync-pill are expected to stay.
6. **`theme-color`** in `app/layout.tsx` updated per §5.6.

## 7. Technical Approach

**Recommended: `next-themes`.** It is the shadcn-canonical solution, ~2KB, fully
offline (no network), and handles exactly our requirements: `system` default,
`localStorage` persistence, cross-tab sync, the pre-paint no-flash script, live
`matchMedia` updates, and a `useTheme()` hook returning `theme` + `resolvedTheme`
+ `setTheme`. We add `attribute="class"`, `defaultTheme="system"`,
`enableSystem`, and `disableTransitionOnChange`.

- Add a client `ThemeProvider` (wrapping `next-themes`) and nest it in
  `app/layout.tsx` alongside `SerwistClientProvider` (provider is client; layout
  stays a server component). Add `suppressHydrationWarning` to `<html>`.
- The Settings control and any header toggle call `setTheme(mode)`.
- `theme-color` sync handled by a small effect reading `resolvedTheme`.

**Alternative (zero-dep):** a ~30–40 line custom hook + inline head script doing
the same thing. Viable, but re-implements what `next-themes` already hardened
(no-flash timing, cross-tab, system listener). Recommend `next-themes` unless we
want to avoid the dependency.

## 8. Implementation Plan

1. **Plumbing:** install `next-themes`; add `ThemeProvider`; wrap in layout;
   `suppressHydrationWarning`; verify class toggles and persists. No flash.
2. **Token gaps:** dark overrides for bespoke vars; theme-aware `html`/`body`;
   editor uploader; amber boxes. (§6.1–6.4)
3. **Settings control:** "Apariencia" segmented control (Sistema/Claro/Oscuro).
4. **PWA theme-color** sync. (§5.6)
5. **Audit + dual-platform pass:** walk every screen in both modes on iOS Safari
   PWA and Android Chrome PWA; fix contrast issues.
6. *(Optional)* header quick-toggle, if chosen in §10.

## 9. Primary Color Note (cross-reference)

The primary-color decision is out of scope here and unchanged. The actual shadcn
`--primary` token in use today is:

- **Light:** `oklch(0.514 0.222 16.935)` — a crimson red (≈ `#c70036`).
- **Dark:** `oklch(0.455 0.188 13.697)` — the darker crimson already present in
  the `.dark` block.

Do not change these (or any other theme/brand color tokens) as part of this work
without a separate go-ahead. Two related observations to flag, not fix here:

- Brand purple has been removed app-wide in favor of the crimson above for
  `--primary` and app icons. PWA shell chrome is separate: `app/layout.tsx`
  `viewport.themeColor` and `manifest.webmanifest` `theme_color` use neutral
  per-mode surface colors from `SHELL_THEME_COLORS` (aligned with each mode's
  `--bg`), not the brand crimson; `ThemeColorSync` overrides `theme-color` when
  the user forces Claro/Oscuro against the OS (§5.6). The page backdrop/glow
  stays a subtle `color-mix` tint from `--primary`, not a solid crimson fill.
- The original product PRD still names the brand as `#6822E2` (purple); that is
  now superseded by the crimson `--primary` going forward. The decorative
  `product-art` tone palette (incl. the per-product `violet`/`aurora` tones) and
  the near-navy toast "info" background are intentionally left as-is.

## 10. Open Questions / Decisions

1. **Header quick-toggle?** Settings-only (simplest), or also a Sun/Moon in
   headers for one-tap switching? (Recommend: Settings-only for v1.)
2. **Default when no OS signal / first run:** Sistema (recommended).
3. **`theme-color` strategy:** media-query meta pair + override effect, vs fully
   provider-managed. (Recommend: provider-managed for correctness under manual
   override.)
4. **Dependency:** accept `next-themes`, or hand-roll zero-dep? (Recommend:
   `next-themes`.)
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
