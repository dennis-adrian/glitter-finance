# Billetera Ferial Design System

Canonical implementation guide for Billetera Ferial’s mobile POS interface.

- Figma source: [Design System — node 133:429](https://www.figma.com/design/WLY3zd17burZJTkSDv6JRa/Billetera-Ferial?node-id=133-429)
- Last reconciled: 2026-08-12
- Code foundations: `app/globals.css`, `app/layout.tsx`, `components/ui/`

## Principles

1. Mobile-first and touch-first. Optimize the primary flow for fast selling at a fair or market.
2. Warm, friendly, and practical. Teal carries the brand; coral is an accent, not a competing primary.
3. Prefer semantic tokens. Components must respond to light and dark themes without local color overrides.
4. Keep hierarchy obvious. One dominant action per view; secondary actions stay visually quieter.
5. Preserve operational clarity. Prices, quantities, payment state, sync state, and destructive actions must never be ambiguous.

## Color

### Primitive ramps

Use primitives only to define semantic tokens. Production components should use semantic roles.

| Step | Teal      | Neutral   | Coral     |
| ---- | --------- | --------- | --------- |
| 50   | `#ECF6F5` | `#FDFCFA` | `#FDF0ED` |
| 100  | `#E0F2F1` | `#F2F0EB` | `#FDE8E2` |
| 200  | `#B3E5E2` | `#E2DCD5` | `#FBCFC7` |
| 300  | `#66CCC2` | `#CFC8BD` | `#F8AEA0` |
| 400  | `#33B6AB` | `#A8A09A` | `#FA8272` |
| 500  | `#009E91` | `#7A7571` | `#E8725A` |
| 600  | `#008B80` | `#5C5855` | `#D05A42` |
| 700  | `#00786F` | `#44413E` | `#AE4534` |
| 800  | `#0D564F` | `#2E2E2E` | `#8F3A2D` |
| 900  | `#1A2E2C` | `#242424` | `#763329` |
| 950  | `#0F1E1C` | `#121212` | `#401714` |

Brand usage:

- Teal 700 is the light-theme primary action and brand color.
- Teal 500 is the dark-theme primary action and brand color.
- Coral 500 is the light-theme accent.
- Coral 400 is the dark-theme accent.
- Teal 900+ may be used for dark text on light surfaces.

### Semantic roles

The Figma design-system aliases are:

| Role                | Light     | Dark      | Intended use                        |
| ------------------- | --------- | --------- | ----------------------------------- |
| `bg/primary`        | `#F2F0EB` | `#242424` | Base neutral region                 |
| `bg/surface`        | `#FFFFFF` | `#2E2E2E` | Cards, sheets, navigation           |
| `bg/elevated`       | `#FFFFFF` | `#44413E` | Raised overlays                     |
| `bg/subtle`         | `#ECF6F5` | `#2E2E2E` | Selected and low-emphasis areas     |
| `text/primary`      | `#1A2E2C` | `#FFFFFF` | Main copy and headings              |
| `text/secondary`    | `#7A7571` | `#A8A09A` | Supporting copy                     |
| `border/default`    | `#E2DCD5` | `#44413E` | Dividers and controls               |
| `brand/primary`     | `#00786F` | `#009E91` | Primary actions and active state    |
| `brand/accent`      | `#E8725A` | `#FA8272` | Secondary emphasis and error accent |
| `interactive/hover` | `#0D564F` | `#33B6AB` | Hover/pressed feedback              |
| `status/success`    | `#4CAF50` | `#4CAF50` | Success state                       |
| `status/error`      | `#E8725A` | `#FA8272` | Error state                         |

### Project token mapping

Use the existing Tailwind/shadcn semantic utilities:

| Purpose              | CSS token            | Tailwind utility                     |
| -------------------- | -------------------- | ------------------------------------ |
| App background       | `--background`       | `bg-background`                      |
| Main text            | `--foreground`       | `text-foreground`                    |
| Card/sheet surface   | `--card`             | `bg-card`                            |
| Supporting surface   | `--muted`            | `bg-muted`                           |
| Supporting text      | `--muted-foreground` | `text-muted-foreground`              |
| Primary brand/action | `--primary`          | `bg-primary`, `text-primary`         |
| Coral accent         | `--secondary`        | `bg-secondary`, `text-secondary`     |
| Divider/control edge | `--border`           | `border-border`                      |
| Focus indicator      | `--ring`             | `ring-ring`                          |
| Destructive state    | `--destructive`      | `text-destructive`, `bg-destructive` |

Project-resolved page surfaces intentionally follow the approved screen designs:

- Light page background: `#FFFDF8`.
- Dark page background: `#1A1A1A`.
- Dark card/panel: `#242424`.
- Dark muted/control surface: `#2E2E2E`.
- Dark border: `#3A3A3A`.
- Dark foreground: `#E8E6E3`; muted foreground: `#9A9896`.

These screen-level values take precedence where the Figma semantic sheet and approved application screens differ.

## Typography

Use exactly two product typefaces:

- **Bricolage Grotesque**: display and brand personality. Use ExtraBold only.
- **Instrument Sans**: all interface text. Available weights: Regular, Medium, SemiBold, Bold.

| Token                   | Family              | Weight    | Size | Use                                   |
| ----------------------- | ------------------- | --------- | ---- | ------------------------------------- |
| `display/large`         | Bricolage Grotesque | ExtraBold | 28px | Primary screen/display title          |
| `display/medium`        | Bricolage Grotesque | ExtraBold | 22px | App title and major heading           |
| `display/small`         | Bricolage Grotesque | ExtraBold | 18px | Compact display copy and monetary CTA |
| `heading/h1`            | Instrument Sans     | Bold      | 16px | Section/page heading                  |
| `heading/h2`            | Instrument Sans     | Bold      | 15px | Subsection heading                    |
| `body/large`            | Instrument Sans     | Regular   | 14px | Default body and input text           |
| `body/medium`           | Instrument Sans     | Regular   | 13px | Supporting copy                       |
| `body/small`            | Instrument Sans     | Regular   | 12px | Metadata and helper text              |
| `body/xsmall`           | Instrument Sans     | Regular   | 11px | Dense metadata only                   |
| `label/large`           | Instrument Sans     | Bold      | 14px | Buttons and prominent labels          |
| `label/medium`          | Instrument Sans     | Bold      | 13px | Form and control labels               |
| `label/small`           | Instrument Sans     | Bold      | 12px | Chips and compact labels              |
| `label/large-semibold`  | Instrument Sans     | SemiBold  | 14px | Secondary actions                     |
| `label/medium-semibold` | Instrument Sans     | SemiBold  | 13px | Secondary control labels              |
| `nav/label`             | Instrument Sans     | SemiBold  | 13px | Bottom navigation                     |

Implementation note: the website currently loads Geist for headings and Inter for UI text in `app/layout.tsx`. That is a known mismatch. The target is Bricolage Grotesque + Instrument Sans.

The component-pattern sheet still labels bottom-navigation text as Figtree. The dedicated Typography sheet supersedes that stale annotation: use Instrument Sans SemiBold 13px.

## Spacing

Use this spacing scale for padding, margins, gaps, and auto-layout spacing:

| Token       | Value | Token       | Value |
| ----------- | ----: | ----------- | ----: |
| `space/2xs` |   2px | `space/2xl` |  14px |
| `space/xs`  |   4px | `space/3xl` |  16px |
| `space/sm`  |   6px | `space/4xl` |  20px |
| `space/md`  |   8px | `space/5xl` |  24px |
| `space/lg`  |  10px | `space/6xl` |  28px |
| `space/xl`  |  12px | `space/7xl` |  32px |

Prefer values from this scale. Avoid one-off spacing unless required by safe areas or an asset’s intrinsic geometry.

## Corner radius

| Token         | Value | Typical use                    |
| ------------- | ----: | ------------------------------ |
| `radius/xs`   |   4px | Small indicators               |
| `radius/sm`   |   8px | Compact containers             |
| `radius/md`   |  12px | Inputs and icon containers     |
| `radius/lg`   |  16px | Cards and product tiles        |
| `radius/xl`   |  20px | Large cards and sheets         |
| `radius/2xl`  |  24px | Prominent panels               |
| `radius/full` | 100px | Pills, chips, circular actions |

## Layout

- Design target: mobile app/PWA; reference screens are approximately 402px wide.
- Application shell: full viewport on phones, centered with a maximum width on larger screens.
- Standard horizontal page padding: 20–24px.
- Standard content grid: two columns with 12–16px gap.
- Account for `env(safe-area-inset-bottom)` in fixed bottom UI.
- Scroll content behind neither the bottom navigation nor checkout dock; reserve bottom padding.
- Use the existing `.app-shell`, `.phone-frame`, and `.screen` layout primitives.

## Component patterns

### Buttons

- Primary: `brand/primary` fill, white text, 48–52px height, full width for main CTAs, full radius.
- Outline: 1.5px `brand/primary` border, primary-colored text, full radius.
- Text/link: transparent background; primary or accent text; underline optional.
- Back: 36×32px, subtle neutral fill, full radius.
- Typography: Instrument Sans Bold, 14–16px.
- Padding: 14–16px vertical and 20–24px horizontal.
- Keep one visually dominant CTA per action group.

### Text inputs

- Height: 48px.
- Border: 1px `border/default`.
- Radius: 12px.
- Horizontal padding: 12–16px.
- Label: Instrument Sans Bold 13px, primary text, 4px gap before input.
- Input/placeholder: Instrument Sans Regular 14px; placeholder uses secondary text.
- Label and input form a single stacked field, approximately 70px tall.

### Chips and category tabs

- Active: primary fill, white Bold 13px label.
- Inactive: subtle border, primary text, Bold 13px label.
- Height: approximately 32px; full radius.
- Padding: 8px vertical, 14–16px horizontal.
- Gap: 8px.
- Place in a horizontally scrollable row; do not wrap on core POS screens.

### Product cards

- Two-column, image-forward grid with 12–16px gap.
- Card radius: 16px.
- Image fills the upper section at approximately 1:1 and inherits the top radius.
- Product name: Instrument Sans Bold 14px.
- Price: Instrument Sans Bold 13px in primary teal; prefix with `Bs`.
- Selected quantity: teal circular badge over the image with white `×N` text.
- The whole tile is the interaction target.

### Bottom navigation

- Four destinations only: **POS Venta**, **Ventas**, **Catálogo**, **Más**.
- Height: approximately 55px plus bottom safe area.
- Icons sit above labels; Lucide icons are 24×24px.
- Active: primary icon and label.
- Inactive: secondary-text icon and label.
- Surface background with a subtle top divider.
- Nested pages such as Reportes and Ajustes keep **Más** active.

### Payment method toggle

- Full-width segmented control, approximately 44px tall.
- Container padding: 4px; container and segment use full radius.
- Active segment: primary fill or white surface with Bold 13px label.
- Inactive segment: transparent with secondary text.
- Place a small payment icon before each label.

### Cart detail panel

- Bottom sheet on a surface background with 20–24px top corners.
- Collapsed state: item count, “Ver detalle,” and the checkout CTA.
- Expanded state: line items, inline decrement/count/increment controls, discounts, and total.
- Discount presets: `2 Bs`, `5 Bs`, `10 Bs`, plus `Otro` for custom input.
- Checkout CTA: full-width primary fill, bold white text, full radius.
- Total: Instrument Sans Bold 16px.

## Icons and imagery

- Use Lucide for interface icons; standard size is 24px, compact size 16–20px.
- Do not mix icon families in one surface.
- Product photography is image-forward, cropped with `object-cover`, and must remain legible behind badges.
- Use the committed Billetera Ferial mark for branding; do not redraw it in component code.

## Interaction and accessibility

- Minimum touch target: 44×44px, even when the visible icon is smaller.
- Every icon-only control needs an accessible name.
- Use visible focus rings based on `--ring`.
- Never encode selection, error, or sync state with color alone; include text, icon, or shape.
- Disabled actions must remain readable and must not respond to pointer or keyboard activation.
- Destructive actions require clear coral/error styling and confirmation when data loss is possible.
- Respect reduced-motion preferences. Motion is supportive and brief, never required to understand state.

## Content conventions

- Product language: Spanish for Bolivia.
- Currency: Bolivianos, displayed with the `Bs` prefix.
- Use short, action-oriented labels: “Cobrar,” “Crear nuevo puesto,” “Cerrar sesión.”
- Keep explanatory text direct and operational; avoid decorative marketing copy during selling flows.

## Implementation rules

1. Reuse components in `components/ui/`, `components/molecules/`, and `components/organisms/` before creating new ones.
2. Use semantic classes such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-secondary`, and `border-border`.
3. Do not hardcode theme-dependent colors inside components.
4. Define or change global theme values in `app/globals.css`.
5. Keep light and dark behavior paired when adding a semantic token.
6. Use the spacing and radius scales above instead of arbitrary values.
7. Validate new screens at phone width, large-screen framed width, light mode, dark mode, and bottom safe-area conditions.
8. When an approved application screen conflicts with the design-system overview, document the exception here and follow the approved screen until Figma is reconciled.
