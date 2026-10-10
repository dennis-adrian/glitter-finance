# Billetera Ferial Design System

Canonical implementation guide for Billetera Ferial’s POS interface on phones,
tablets, and desktops.

- Figma source: [Design System — node 133:429](https://www.figma.com/design/WLY3zd17burZJTkSDv6JRa/Billetera-Ferial?node-id=133-429)
- Last reconciled with Figma: 2026-08-12 (Figma still shows phone screens
  only); with the code: 2026-10-09 (responsive layout, navigation, order,
  checkout, and categories)
- Code foundations: `app/globals.css`, `app/layout.tsx`, `components/ui/`

## Principles

1. Mobile-first, touch-first, and responsive. Optimize the primary flow for fast selling at a fair or market on a phone, and use the extra space on tablets and desktops instead of framing the phone layout.
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
Figma role. `--bg` (the `html` background, equal to `--background`)
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
| `nav/label`             | Instrument Sans     | SemiBold  | 12px | Bottom navigation and icon rail       |

`app/layout.tsx` loads Bricolage Grotesque (headings) and Instrument Sans (UI text) to match this table.

The component-pattern sheet still labels bottom-navigation text as Figtree. The dedicated Typography sheet supersedes that stale annotation: use Instrument Sans SemiBold. Five destinations at 320–375px need 12px (the Typography sheet's 13px was sized for four).

Implemented exceptions to this table (see the component patterns below):

- The active navigation label is Bold instead of `nav/label` SemiBold.
- Vender tiles show the product name in Regular 15px and the price in Bold 20px.
- Screen header titles are Bricolage Grotesque ExtraBold 20px in primary teal.
- Inputs use 16px text below the `md` breakpoint, so iOS Safari does not zoom in on focus, and 14px from `md` up.
- `font-extrabold` on Instrument Sans (the total in the checkout bar's **Cobrar** button) renders as Bold, the heaviest weight `app/layout.tsx` loads.

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

The app fills the viewport at every size. There is no framed "phone" shell.

### Breakpoints

Tailwind defaults, used the same way on every screen:

| Tier    | Width       | Navigation              | Typical layout                                     |
| ------- | ----------- | ----------------------- | -------------------------------------------------- |
| Phone   | < 768px     | Bottom nav              | One column; sheets slide up from the bottom        |
| Tablet  | `md` 768px  | Icon rail (88px)        | Denser grids; sheets slide in from the side        |
| Desktop | `lg` 1024px | Icon rail               | Split views: register + order panel, list + detail |
| Wide    | `xl` 1280px | Labeled sidebar (240px) | Same as desktop with more room                     |

Phones in landscape are usually ≥ 768px wide and get the rail, which keeps
vertical space for content.

### Shell and screens

- `GlitterPosApp` renders `SideNav` (md+), the active screen in `<main>`, and
  `BottomNav` (phones, top-level screens only).
- Every screen uses the `Screen` template (`components/templates/screen.tsx`):
  a fixed header, one scrolling body, and an optional in-flow footer. Footers
  (checkout bar, save bar, confirm button) sit in normal flow above the bottom
  nav. Never position docks with pixel offsets.
- `ScreenHeader` titles are left-aligned so actions fit on the same row. On
  phones it shows the brand mark (top-level screens) or a back button, plus
  the sync pill. The rail/sidebar carries the brand and sync pill from `md`.
- Content widths: `narrow` (max 672px) for settings, detail, and confirmation
  screens; `medium` (max 1024px) for forms and checkout; `wide` (max 1536px)
  for grids, lists, and dashboards. Header, body, and footer share the width so
  edges align.
- Horizontal gutters: 16px phones, 24px tablets, 32px desktops.
- Product grids auto-fill columns with a 152px (9.5rem) minimum: 2 on phones,
  3–5 on larger screens. Gaps 12px on phones, 16px from `md`.
- Touch devices hide scrollbars in scroll regions; mouse users keep them.

### Split views

- **Vender (lg+):** product grid plus a persistent order panel (352px, 400px
  at `xl`) on the right. Below `lg` the order lives in a sheet.
- **Ventas (lg+):** list column (480px, 544px at `xl`) plus the sale detail in
  a pane; the pane closes with an X. Below `lg`, opening a sale replaces the
  list.
- **Catálogo (lg+):** a table instead of cards.
- **Checkout (lg+):** order summary beside the payment options.
- **Product editor (md+):** image column beside the fields.

### Routing

Screens live in the URL hash so the document URL stays `/` (the service
worker's offline page cache keeps working) while back/forward, refresh, and
deep links work. Pure parsing lives in `lib/views.ts`; `useAppRoute` wraps the
history API.

| Hash                                          | Screen                             |
| --------------------------------------------- | ---------------------------------- |
| _(none)_                                      | Vender                             |
| `#/pedido`                                    | Vender with the order sheet open   |
| `#/cobrar`                                    | Checkout                           |
| `#/cobrado`                                   | Sale confirmation (not restorable) |
| `#/ventas`, `/<id>`                           | Sales list, sale detail            |
| `#/catalogo`                                  | Catalog                            |
| `#/catalogo/nuevo`, `/<id>`                   | New product, edit product          |
| `#/catalogo/categorias`                       | Categories                         |
| `#/reportes`                                  | Reports                            |
| `#/mas`, `#/ajustes`, `#/ajustes/diagnostico` | Más, settings, diagnostics         |

In-app back buttons call `back(fallback)`: they pop history when the previous
entry belongs to the app and otherwise replace the entry with the parent
screen, so Back never leaves the app from a deep link.

### Safe areas

Fixed bottom UI (bottom nav) pads with `env(safe-area-inset-bottom)`. Because
footers are in flow, nothing else needs safe-area math.

### On-screen keyboard

The browser's own "scroll the field into view" can't reach inside the shell's
scroll regions, so the app handles it (`useVirtualKeyboard`):

- The viewport uses `interactive-widget=resizes-content` (Android shrinks the
  layout); iOS is covered with the VisualViewport API.
- While the keyboard is open, the shell sizes itself to the visible area
  (`--app-height`), the bottom nav hides, and the focused field scrolls to the
  middle of its scroll region, so the header and footer actions (e.g.
  **Registrar venta**) stay visible above the keyboard.
- Bottom-anchored overlays (the order sheet, dialogs with text fields) lift by
  `--keyboard-inset` and cap their height to `--app-height`. Use both for any
  new bottom sheet that contains a text field.

## Component patterns

Each pattern describes what `components/` implements. Where it differs from
the Figma component sheet, the Figma value follows in a "Figma:" note; these
are the recorded exceptions of implementation rule 9.

### Buttons

`components/ui/button.tsx`; every variant has a full radius.

- Primary (`default`): `brand/primary` fill, white text, `--interactive-hover` fill on hover. 48px tall, or 52px (`lg`) for main CTAs such as **Cobrar** and **Registrar venta**, full width for main CTAs.
- Secondary: coral fill (`--secondary`) with dark coral text (`--secondary-foreground`). No screen uses it since the order rework replaced the coral cart button and QR method; the tile's stock pill uses the matching `Badge` variant.
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
- Input text: Instrument Sans Regular, 16px below `md` and 14px from `md` up; the placeholder is `--muted-foreground` at 70%, lighter than supporting text, so it reads as an example rather than a value.
- Focus: `--ring` border and a 3px ring at 50% opacity. Invalid fields use `--destructive`.

### Chips and category tabs

- Compact buttons: 36px tall, full radius, 16px horizontal padding, Bold 14px label. Figma: about 32px tall, Bold 13px, 8px vertical padding.
- Active: primary fill, white label, `aria-pressed`.
- Inactive: the outline button: 1.5px primary border, primary text, no fill.
- Gap: 8px.
- Place in a horizontally scrollable row that bleeds to the screen edge, without a visible scrollbar; do not wrap on core POS screens.
- Category chips come from the puesto's own categories (see Categories).

### Product cards

The Vender tile (`components/molecules/product-tile.tsx`):

- Image-forward grid that auto-fills columns (152px minimum): two on phones,
  more on larger screens, with a 12px gap (16px from `md`).
- Card: `--card` surface, 16px radius, a faint `foreground/10` ring.
- Image fills the upper section at 1.13:1 and inherits the top radius. Without a photo, a flat tile tinted by the product's tone shows its initial.
- Product name: Instrument Sans Regular 15px, up to two lines, then truncated. Figma: Bold 14px.
- Price: Instrument Sans Bold 20px in primary teal, as `N Bs` (see Content conventions). Figma: Bold 13px, `Bs` first.
- Quantity in the order: a 28px teal pill in the top-right corner of the image with white Bold 14px `N×` text (`3×`), and a 2px primary ring around the tile. Figma: a circular badge reading `×N`.
- Stock, for tracked products only: a 24px coral pill in the top-left corner with the count, "agotado", or the negative figure; low and oversold add a warning icon, oversold uses the destructive tint, and out-of-stock and oversold tiles get a faint destructive ring.
- The whole tile adds one. Once the product is in the order, a separate `−`
  button (at least a 44px target) in the bottom-right corner removes one; a
  long press still removes one as a shortcut.
- The tile's accessible name includes name, price, quantity in the order, and
  stock state.

### Navigation

- Five destinations: **Vender**, **Ventas**, **Catálogo**, **Reportes**, **Más**
  (`components/organisms/nav-items.ts`). Más holds the account, puesto
  switching and creation, Ajustes, and sign-out. Ajustes holds only settings:
  Equipo (members and invite link), Apariencia, and Soporte (Diagnósticos,
  which also shows the records loaded on the device).
- Phones (`components/organisms/bottom-nav.tsx`): about 60px plus the bottom
  safe area, with a top divider; 20px Lucide icons above the labels; hidden on
  sub-screens (detail, editor, checkout) that have a back button and while the
  on-screen keyboard is open.
- Tablets/desktops (`components/organisms/side-nav.tsx`): icon rail (`md`)
  that expands to a labeled sidebar (`xl`), with the brand at the top and the
  sync pill at the bottom.
- Active item: primary icon and Bold label plus a tinted pill behind the icon,
  so selection isn't color-only, and `aria-current="page"`. Inactive items use
  supporting text.
- Sub-screens keep their section active (Ajustes and Diagnósticos keep
  **Más** active; sale detail keeps **Ventas** active).
- Figma: four destinations (Reportes under Más), about 55px plus the safe
  area, 24px icons, SemiBold 13px labels.

### Segmented control

`components/molecules/segmented-control.tsx`, used for the payment method,
date presets, catalog status, and stock corrections.

- Full-width pill track (`bg-muted`, 4px padding), equal-width segments,
  44px tall (36px `sm`).
- Active segment: primary fill with a Bold label. Inactive: transparent with
  secondary text.
- Optional icon before each label. It is a radio group: arrow keys move the
  selection.
- Can start with nothing selected (`value={null}`) when a choice must be
  explicit; the first segment is then the one that takes focus.
- The Sistema / Claro / Oscuro theme picker in Ajustes is not a segmented
  control: three 56px buttons (the `lg` size with an `h-14` override), the
  selected one filled, the others outlined.

### Order (pedido)

- One `OrderPanel` organism renders the current order everywhere: a header
  (count and **Vaciar**), line items, the total, and a centered **Cobrar**
  button (the total sits right above it, so the button doesn’t repeat it).
  **Vaciar** empties the order at once and shows a toast whose **Deshacer**
  brings the lines back.
- Desktop (lg+): persistent side panel beside the product grid.
- Phones and tablets: a checkout bar is always visible on Vender, so the
  selling screen never looks like Catálogo. It has the order button (bag with
  a count badge and an expand caret; tablets add the **Ver pedido** label) and
  **Cobrar · total**. Both are disabled while the order is empty. The order
  button opens the order as a sheet: bottom on phones, sized to its content;
  right side on tablets.
- Order lines use two rows (art, name, total; then stepper and actions) so
  they fit 320px. The stepper sits on a neutral fill.
- Line discounts use the `%` action to show amount (Bs or `%`) and an
  optional reason. An amount the field can't read shows an error under it
  instead of being ignored.
- Figma: a bottom sheet with collapsed (“Ver detalle”) and expanded states,
  the sale discount presets inside it, and a Bold 16px total.

### Checkout

- Recording a sale is always an explicit final step. Choosing a payment
  method never records anything.
- Sale discount presets: `2 Bs`, `5 Bs`, `10 Bs`, plus **Otro** (amount or
  `%`). Tap an active preset again to remove it.
- Payment method: segmented control (**Efectivo**, **QR**) with **Efectivo**
  selected by default, since cash is the most common payment at fairs.
- Cash: received-amount presets (**Exacto** plus the total rounded up to 20,
  50, 100, and 200 Bs bills), a custom field, and a live **Cambio** or
  **Falta** readout. Short or unreadable amounts disable the confirm button.
- QR: a reminder to confirm the transfer arrived.
- The footer button states what happens next: **Faltan X Bs** (disabled) or
  **Registrar venta · total**. When the total is out of range, the button
  reads **Registrar venta**, stays disabled, and the totals show “—”.
- Confirmation screen: total, change to hand back, **Nueva venta**
  (primary), **Compartir recibo** (Web Share, clipboard fallback), and a link
  to the recorded sale.
- Figma: the same segmented payment toggle, about 44px tall.

### Categories

- Each puesto manages its own categories (the `categories` table); there is
  no fixed list. **Catálogo › Categorías** (`#/catalogo/categorias`) creates,
  renames (products follow, since they point to the category by id), and
  deletes empty categories.
- Filters show **Todos** plus the categories that have products in the
  current list, and hide when there is only one.
- The product editor shows the categories as chips plus **Nueva categoría**,
  which opens the create form and selects the new category. If a product's
  current category hasn't reached this device yet, it still shows as a chip
  (selected) so saving never changes it silently.

### Dialogs and confirmation

- Use `ConfirmDialog` (base-ui AlertDialog) for anything that loses data:
  discard unsaved edits, archive a product, void or refund a sale.
- Bottom sheet on phones, centered from `sm`; destructive confirms use the
  destructive button variant.
- Forms with unsaved changes also warn on reload.

### Charts

- Reports use one single-series column chart (net revenue per hour/day/week,
  `components/molecules/sales-trend-chart.tsx`, drawn with Recharts) in
  `--primary`. No legend, because the section title names the series.
- Bars ≤ 24px with a 4px rounded top; hairline horizontal grid; muted axis
  text; hover tooltip with amount and sale count.
- Always include an equivalent visually hidden table.
- The category and payment breakdowns are plain bars scaled to the largest
  amount.

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
- A tenant is a **puesto** (“Tus puestos,” “Crear nuevo puesto,” “Nombre del puesto”). **Cuenta** is only the user's sign-in account (“Crear cuenta,” “¿Ya tenés una cuenta?,” “Salí de tu cuenta”). The same test flags phrases that can only mean a tenant, such as “Tus cuentas” or “Nombre de la cuenta.”
- Currency: Bolivianos, written after the amount: `45 Bs`, `1.234,50 Bs` (`formatBs(cents, true)` in `lib/money.ts`). Whole amounts have no decimals, others two, with es-BO separators. The `Bs 45` form (`formatBs(cents)`) appears only inside validation messages.
- Use short, action-oriented labels in sentence case: “Cobrar,” “Crear nuevo
  puesto,” “Cerrar sesión,” “Iniciar sesión.” No all-caps or Title Case
  buttons or titles.
- Call the in-progress sale the **pedido** (order), not carrito.
- Keep explanatory text direct and operational; avoid decorative marketing copy during selling flows.

## Implementation rules

1. Reuse components in `components/ui/`, `components/molecules/`, and `components/organisms/` before creating new ones.
2. Use semantic classes such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-secondary`, and `border-border`.
3. Do not hardcode theme-dependent colors inside components.
4. Define or change global theme values in `app/globals.css`.
5. Keep light and dark behavior paired when adding a semantic token.
6. Use the spacing and radius scales above instead of arbitrary values.
7. Validate new screens at 375px, 768px, 1024px, and 1440px wide, in light and dark mode, and with the bottom safe area.
8. Put new screens in the `Screen` template with a `ScreenHeader`; add a route in `lib/views.ts` for anything that should survive a reload or a back press.
9. When an approved application screen conflicts with the design-system overview, document the exception here and follow the approved screen until Figma is reconciled.
