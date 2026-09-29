# Billetera Ferial Design System

Canonical implementation guide for Billetera Ferial’s mobile POS interface.

- Figma source: [Design System — node 133:429](https://www.figma.com/design/WLY3zd17burZJTkSDv6JRa/Billetera-Ferial?node-id=133-429)
- Last reconciled with Figma: 2026-08-12; with the code: 2026-09-28
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

| Purpose                   | CSS token                | Tailwind utility                                  |
| ------------------------- | ------------------------ | ------------------------------------------------- |
| App background            | `--background`           | `bg-background`                                   |
| Main text                 | `--foreground`           | `text-foreground`                                 |
| Card/sheet surface        | `--card`                 | `bg-card`                                         |
| Popover and toast surface | `--popover`              | `bg-popover`                                      |
| Supporting surface        | `--muted`                | `bg-muted`                                        |
| Supporting text           | `--muted-foreground`     | `text-muted-foreground`                           |
| Primary brand/action      | `--primary`              | `bg-primary`, `text-primary`                      |
| Primary hover/pressed     | `--interactive-hover`    | `hover:bg-[var(--interactive-hover)]`             |
| Coral accent              | `--secondary`            | `bg-secondary`, `text-secondary`                  |
| Text on coral             | `--secondary-foreground` | `text-secondary-foreground`                       |
| Divider/control edge      | `--border`               | `border-border`                                   |
| Input edge                | `--input`                | `border-input`                                    |
| Focus indicator           | `--ring`                 | `ring-ring`                                       |
| Destructive state         | `--destructive`          | `text-destructive`, `bg-destructive`              |
| Positive figures          | `--green`                | `text-[var(--green)]`                             |
| Warning text and edge     | `--amber`                | `text-[var(--amber)]`, `border-[var(--amber)]/35` |
| Warning surface           | `--amber-surface`        | `bg-[var(--amber-surface)]`                       |
| Dialog shadow             | `--shadow`               | `shadow-[var(--shadow)]`                          |

`interactive/hover` is `--interactive-hover`, with the same values as the
Figma role. `--bg` (the page behind the app frame, equal to `--background`)
and `--soft-shadow` (floating controls) are used only inside
`app/globals.css`. `--panel`, `--ink`, `--hairline` and `--danger` are legacy
variables that nothing uses; they stand in for `--card`, `--foreground`,
`--border` and `--destructive`. Do not use them in new code; removing them is
left to a CSS cleanup. The shadcn `--chart-*` and `--sidebar-*` tokens are
defaults that no screen uses yet.

Project-resolved values intentionally differ from the Figma semantic sheet,
following the approved screen designs or a contrast check:

- Light page background: `#FFFDF8`.
- Dark page background: `#1A1A1A`.
- Dark card/panel: `#242424`.
- Dark muted/control surface: `#2E2E2E`.
- Dark border: `#3A3A3A`.
- Dark foreground: `#E8E6E3`; muted foreground: `#9A9896`.
- Light supporting text (`--muted-foreground`): `#5C5855` (Neutral 600), not
  `text/secondary` `#7A7571`, which is 4.48:1 on the light page background,
  just under WCAG AA for body text. `#5C5855` is 6.9:1.
- Light destructive (`--destructive`): `#AE4534` (Coral 700), not
  `status/error` `#E8725A`, which is 3.0:1 as text; `#AE4534` is 5.6:1 and
  still reads as coral. Dark keeps `#FA8272`, and the light coral accent
  (`--secondary`) stays `#E8725A`.
- Success green (`--green`): `#4CAF50` light and `#4ADE80` dark, brighter on
  dark cards, where `status/success` is `#4CAF50` in both. The sync pill's
  synced dot is a fixed `#14B86E` in both modes, on the pill's own dark
  background.
- Warning amber, for which Figma has no role: `--amber` `#B7791F` light and
  `#FBBF24` dark, on `--amber-surface` `#FFF8E8` light and
  `oklch(0.28 0.04 75)` dark. Used for "cost incomplete" notices and metrics.

These values take precedence where the Figma semantic sheet and the approved
application screens differ.

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

`app/layout.tsx` loads Bricolage Grotesque (headings) and Instrument Sans (UI text) to match this table.

The component-pattern sheet still labels bottom-navigation text as Figtree. The dedicated Typography sheet supersedes that stale annotation: bottom-navigation text is Instrument Sans.

Implemented exceptions to this table (see the component patterns below):

- Bottom-navigation labels are 11px, Bold when active and Regular otherwise, instead of `nav/label`.
- Sell Mode tiles show the product name in Regular 15px and the price in Bold 20px.
- Screen header titles are Bricolage Grotesque ExtraBold 20px in primary teal.
- Inputs use 16px text below the `md` breakpoint, so iOS Safari does not zoom in on focus, and 14px from `md` up.
- `font-extrabold` on Instrument Sans (COBRAR, some CTAs) renders as Bold, the heaviest weight `app/layout.tsx` loads.

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

| Token         | Value | Tailwind class | Typical use                    |
| ------------- | ----: | -------------- | ------------------------------ |
| `radius/xs`   |   4px | `rounded-xs`   | Small indicators               |
| `radius/sm`   |   8px | `rounded-md`   | Compact containers             |
| `radius/md`   |  12px | `rounded-xl`   | Inputs and icon containers     |
| `radius/lg`   |  16px | `rounded-2xl`  | Cards and product tiles        |
| `radius/xl`   |  20px | `rounded-3xl`  | Large cards and sheets         |
| `radius/2xl`  |  24px | `rounded-4xl`  | Prominent panels               |
| `radius/full` | 100px | `rounded-full` | Pills, chips, circular actions |

`app/globals.css` (`@theme inline`) resets Tailwind's radius scale to these
values, so the Tailwind class names do not match the Figma token names: Figma
`radius/lg` is `rounded-2xl`. The scale also has two duplicate steps,
`rounded-sm` (4px, like `rounded-xs`) and `rounded-lg` (8px, like
`rounded-md`); use the classes in the table. `--radius` (12px) is shadcn's
base radius, which the toasts use.

## Layout

- Design target: mobile app/PWA; reference screens are approximately 402px wide.
- Application shell: full viewport on phones, centered with a maximum width on larger screens.
- Standard horizontal page padding: 16px (`.screen`); 20px on Más.
- Standard content grid: two columns with 12–16px gap (14px on Sell Mode).
- Account for `env(safe-area-inset-bottom)` in fixed bottom UI.
- Scroll content behind neither the bottom navigation nor checkout dock; reserve bottom padding.
- Use the existing `.app-shell`, `.phone-frame`, and `.screen` layout primitives.

## Component patterns

Each pattern describes what `components/` implements. Where it differs from
the Figma component sheet, the Figma value follows in a "Figma:" note; these
are the recorded exceptions of implementation rule 8.

### Buttons

`components/ui/button.tsx`; every variant has a full radius.

- Primary (`default`): `brand/primary` fill, white text, `--interactive-hover` fill on hover. 48px tall, or 52px (`lg`) for main CTAs such as COBRAR, full width for main CTAs.
- Secondary: coral fill (`--secondary`) with dark coral text (`--secondary-foreground`): the QR payment method and the cart button beside COBRAR.
- Outline: 1.5px `brand/primary` border, primary-colored text.
- Ghost: no fill at rest, muted fill on hover: header icon buttons and **Vaciar**.
- Destructive: tinted destructive fill (`bg-destructive/10`) with destructive text.
- Text/link: transparent background, primary text, underline on hover.
- Compact (`sm`): 36px tall, for category chips and inline actions.
- Back: a ghost 48×48px icon button with a 24px chevron, named "Volver". Figma: 36×32px visual box with a subtle neutral fill.
- Icon buttons smaller than 44px (`icon-sm` 36px, `icon-xs` 28px) extend their hit area to 44×44px.
- Typography: Instrument Sans Bold, 14px (16px on `lg`).
- Padding: 20px horizontal (24px on `lg`).
- Keep one visually dominant CTA per action group.

### Text inputs

- Height: 48px.
- Border: 1px `--input` (the `border/default` value); `--card` fill.
- Radius: 12px.
- Horizontal padding: 16px.
- Label (`FormField`): Instrument Sans Medium 14px, main text, 6px gap before the input; an optional hint sits at the right of the label in supporting text. Figma: Bold 13px, 4px gap.
- Input text: Instrument Sans Regular, 16px below `md` and 14px from `md` up; the placeholder uses supporting text.
- Focus: `--ring` border and a 3px ring at 50% opacity. Invalid fields use `--destructive`.

### Chips and category tabs

- Compact buttons: 36px tall, full radius, 16px horizontal padding, Bold 14px label. Figma: about 32px tall, Bold 13px, 8px vertical padding.
- Active: primary fill, white label, `aria-pressed`.
- Inactive: the outline button: 1.5px primary border, primary text, no fill.
- Gap: 8px.
- Place in a horizontally scrollable row without a visible scrollbar; do not wrap on core POS screens.

### Product cards

The Sell Mode tile (`components/molecules/product-tile.tsx`):

- Two-column, image-forward grid with a 14px gap.
- Card: `--card` surface, 16px radius, a faint `foreground/10` ring, at least 236px tall.
- Image fills the upper section at 1.13:1 and inherits the top radius. Without a photo, a flat tile tinted by the product's tone shows its initial.
- Product name: Instrument Sans Regular 15px. Figma: Bold 14px.
- Price: Instrument Sans Bold 20px in primary teal, as `N Bs` (see Content conventions). Figma: Bold 13px, `Bs` first.
- Quantity in the cart: a 28px teal pill in the top-right corner of the image with white Bold 14px `N×` text (`3×`), and a 2px primary ring around the tile. Figma: a circular badge reading `×N`.
- Stock, for tracked products only: a 24px coral pill in the top-left corner with the count, "agotado", or the negative figure; low and oversold add a warning icon, oversold uses the destructive tint, and out-of-stock and oversold tiles get a faint destructive ring.
- The whole tile is the interaction target: tap adds one, a long press removes one.

### Bottom navigation

`components/organisms/bottom-nav.tsx`:

- Four destinations only: **POS Venta**, **Ventas**, **Catálogo**, **Más**.
- At least 66px tall: 10px top padding, and a bottom padding of 8px or the safe area, whichever is larger.
- Icons sit above labels; Lucide icons are 20×20px.
- Labels: Instrument Sans 11px.
- Active: primary icon and Bold label, `aria-current="page"`.
- Inactive: supporting-text icon and Regular label.
- Surface background with a top divider and a soft upward shadow.
- Nested pages such as Reportes and Ajustes keep **Más** active.
- Figma: about 55px plus the safe area, 24px icons, SemiBold 13px labels.

### Checkout dock

`components/organisms/checkout-dock.tsx`, fixed above the bottom navigation in Sell Mode, 16px from each side:

- Cart button: a 52px coral circle with a Lucide `ReceiptText` icon and a teal count badge; it opens the cart.
- COBRAR: a 52px primary button filling the rest of the row, with the label on the left and the live total on the right (Bold 18px). While the cart is empty it stays visible with a muted fill and does nothing. The finance PRD first placed the amount under the label.

### Payment methods

- Two stacked full-width buttons on the payment screen, 48px tall: **Efectivo** (primary) and **QR** (secondary coral), each with a 24px icon before the label and a chevron after it.
- Tapping one records the sale at once; there is no selected state and no confirm step (finance PRD §7.2).
- Figma: a full-width segmented toggle, about 44px tall. The segmented pattern is used by the Sistema / Claro / Oscuro theme picker in Ajustes: three 56px buttons (the `lg` size with an `h-14` override), the selected one filled, the others outlined.

### Cart

- A full screen (“Tu Carrito”), not a bottom sheet. Each line is a card with a 58px thumbnail, the name, the unit price and any line discount, the line total in primary, and a coral pill stepper (− count +). Two 36px icon buttons below it edit the line discount (an inline amount-or-percentage field with an optional reason) and remove the line.
- A summary panel is fixed at the bottom: the item count, **Total: N Bs** in Bold 24px, a ghost destructive **Vaciar** (with an undo toast), the full-width COBRAR button, and an outline **Agregar más productos** button.
- Sale discount presets are on the payment screen: `2 Bs`, `5 Bs`, `10 Bs`, plus **Otro** for a custom amount or percentage, in a four-column row of outline buttons; the applied one is filled.
- Figma: a bottom sheet with collapsed (“Ver detalle”) and expanded states, the discount presets inside it, and a Bold 16px total.

### Sign-in screens

`/login` and `/auth/update-password` (`components/templates/auth-page-shell.tsx`, the `auth-*` molecules and `google-sign-in-button.tsx`) follow the approved Login design, in token colors so they follow the theme:

- An app-width card on `--background`, the whole screen on phones, surrounded by `bg-foreground/5` on wider screens.
- Supporting text is `text-foreground/70`, which matches the design's `#5A6B68`, not `--muted-foreground`; the “o” between Google and email sign-in is `text-foreground/60`.
- Sign-in actions use the primary and outline button colors. The Google button (a `--card` fill) and the back button have neutral `--input` tints for their fills.
- Error notices have a `--secondary` edge on a 10% `--secondary` fill; status notices a `--primary` edge on `--muted`.
- Three light colors have no token and stay as hex until the design is reconciled, each with a token in dark mode: the error notice text `#8A3329` (dark: `--destructive`), the status notice text `#005F58` (dark: `--foreground`) and the pending submit button's fill `#B4C2BF` (dark: `--muted`).

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
- Voice: address the user as vos, never tú or usted: “Revisá la conexión,” “Tocá productos,” “Si no podés esperar,” “Ya no tenés acceso.” An imperative with a pronoun attached has no accent (“Intentalo,” “Conectate,” “Copialo”). Negative commands and other subjunctives keep the common form (“no cierres sesión,” “hasta que lo revoques”). `tests/ui-copy-voice.test.ts` catches the usual tú forms.
- A tenant is a **puesto** (“Tus puestos,” “Crear nuevo puesto,” “Nombre del puesto”). **Cuenta** is only the user's sign-in account (“Crear Cuenta,” “¿Ya tenés una cuenta?,” “Salí de tu cuenta”). The same test flags phrases that can only mean a tenant, such as “Tus cuentas” or “Nombre de la cuenta.”
- Currency: Bolivianos, written after the amount: `45 Bs`, `1.234,50 Bs` (`formatBs(cents, true)` in `lib/money.ts`). Whole amounts have no decimals, others two, with es-BO separators. The `Bs 45` form (`formatBs(cents)`) appears only inside validation messages.
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
