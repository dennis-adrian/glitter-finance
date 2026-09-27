# Billetera Ferial Design System

Canonical implementation guide for Billetera Ferial’s POS interface on phones,
tablets, and desktops.

- Figma source: [Design System — node 133:429](https://www.figma.com/design/WLY3zd17burZJTkSDv6JRa/Billetera-Ferial?node-id=133-429)
- Last reconciled: 2026-08-12 (responsive layout, navigation, and checkout
  sections updated 2026-09-26; Figma still shows phone screens only)
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
| `nav/label`             | Instrument Sans     | SemiBold  | 12px | Bottom navigation and icon rail       |

`app/layout.tsx` loads Bricolage Grotesque (headings) and Instrument Sans (UI text) to match this table.

The component-pattern sheet still labels bottom-navigation text as Figtree. The dedicated Typography sheet supersedes that stale annotation: use Instrument Sans SemiBold. Five destinations at 320–375px need 12px (the Typography sheet's 13px was sized for four).

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
| `#/reportes`                                  | Reports                            |
| `#/mas`, `#/ajustes`, `#/ajustes/diagnostico` | Más, settings, diagnostics         |

In-app back buttons call `back(fallback)`: they pop history when the previous
entry belongs to the app and otherwise replace the entry with the parent
screen, so Back never leaves the app from a deep link.

### Safe areas

Fixed bottom UI (bottom nav) pads with `env(safe-area-inset-bottom)`. Because
footers are in flow, nothing else needs safe-area math.

## Component patterns

### Buttons

- Primary: `brand/primary` fill, white text, 48–52px height, full width for main CTAs, full radius.
- Outline: 1.5px `brand/primary` border, primary-colored text, full radius.
- Text/link: transparent background; primary or accent text; underline optional.
- Back: 36×32px visual content box, 44×44px minimum hit area, subtle neutral fill, full radius.
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
- Place in a horizontally scrollable row that bleeds to the screen edge; do not wrap on core POS screens.
- Category chips come from the vendor's own categories (see Categories).

### Product cards

- Image-forward grid that auto-fills columns (152px minimum): two on phones,
  more on larger screens, with a 12–16px gap.
- Card radius: 16px.
- Image fills the upper section at approximately 1:1 and inherits the top radius.
- Product name: up to two lines, then truncated.
- Price in primary teal with the `Bs` suffix.
- Selected quantity: teal circular badge over the image with white `×N` text.
- The whole tile adds one. Once the product is in the order, a separate `−`
  button (44px target) removes one; long-press still works as a shortcut.
- The tile's accessible name includes name, price, quantity in the order, and
  stock state.

### Navigation

- Five destinations: **Vender**, **Ventas**, **Catálogo**, **Reportes**, **Más**
  (`components/organisms/nav-items.ts`). Más holds the account, puesto
  switching and creation, Ajustes, and sign-out. Ajustes holds only settings:
  Equipo (members and invite link), Apariencia, and Soporte (Diagnósticos,
  which also shows the records loaded on the device).
- Phones: bottom nav, about 56px plus the bottom safe area; icon above label;
  hidden on sub-screens (detail, editor, checkout) that have a back button.
- Tablets/desktops: icon rail (`md`) that expands to a labeled sidebar
  (`xl`), with the brand at the top and the sync pill at the bottom.
- Active item: primary icon and label plus a tinted pill behind the icon, so
  selection isn't color-only. Inactive items use secondary text.
- Sub-screens keep their section active (Ajustes and Diagnósticos keep
  **Más** active; sale detail keeps **Ventas** active).

### Segmented control

`components/molecules/segmented-control.tsx`, used for the payment method,
date presets, catalog status, and stock corrections.

- Full-width pill track (`bg-muted`, 4px padding), equal-width segments,
  44px tall (36px `sm`).
- Active segment: primary fill with a Bold label. Inactive: transparent with
  secondary text.
- Optional icon before each label. It is a radio group: arrow keys move the
  selection.
- May start with nothing selected when the choice must be explicit (payment
  method).

### Order (pedido)

- One `OrderPanel` organism renders the current order everywhere: a header
  (count and **Vaciar**), line items, the total, and a centered **Cobrar**
  button (the total sits right above it, so the button doesn’t repeat it).
- Desktop (lg+): persistent side panel beside the product grid.
- Phones and tablets: a checkout bar (**Ver pedido** with a count badge, and
  **Cobrar · total**) appears once the order has items. **Ver pedido** opens
  the order as a sheet: bottom on phones, sized to its content; right side on
  tablets.
- Order lines use two rows (art, name, total; then stepper and actions) so
  they fit 320px. The stepper sits on a neutral fill.
- Line discounts use the `%` action to show amount (Bs or `%`) and an
  optional reason.

### Checkout

- Recording a sale is always an explicit final step. Choosing a payment
  method never records anything.
- Sale discount presets: `2 Bs`, `5 Bs`, `10 Bs`, plus **Otro** (amount or
  `%`). Tap an active preset again to remove it.
- Payment method: segmented control (**Efectivo**, **QR**) with nothing
  selected by default.
- Cash: received-amount presets (**Exacto** plus the total rounded up to 20,
  50, 100, and 200 Bs bills), a custom field, and a live **Cambio** or
  **Falta** readout. Short amounts disable the confirm button.
- QR: a reminder to confirm the transfer arrived.
- The footer button states what happens next: **Elegí un método de pago**,
  **Faltan X Bs**, or **Registrar venta · total**.
- Confirmation screen: total, change to hand back, **Nueva venta**
  (primary), **Compartir recibo** (Web Share, clipboard fallback), and a link
  to the recorded sale.

### Categories

- Categories belong to each vendor: they are the names their products use.
  There is no fixed list.
- Filters show **Todos** plus every category in use, and hide when there is
  only one.
- The product editor offers existing categories as chips plus **Nueva
  categoría**. Typed names are trimmed and matched ignoring case and accents,
  so they reuse an existing spelling instead of duplicating it.

### Dialogs and confirmation

- Use `ConfirmDialog` (base-ui AlertDialog) for anything that loses data:
  discard unsaved edits, archive a product, void or refund a sale.
- Bottom sheet on phones, centered from `sm`; destructive confirms use the
  destructive button variant.
- Forms with unsaved changes also warn on reload.

### Charts

- Reports use one single-series column chart (net revenue per hour/day/week)
  in `--primary`. No legend, because the section title names the series.
- Bars ≤ 24px with a 4px rounded top; hairline horizontal grid; muted axis
  text; hover tooltip with amount and sale count.
- Always include an equivalent visually hidden table.

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

- Product language: Spanish for Bolivia, addressing the seller with **vos**
  (“Tocá un producto”, “Revisá el rango”, “Cerrá sesión”). Negative commands
  keep the common form (“no cierres”).
- Currency: Bolivianos, displayed with the `Bs` prefix.
- Use short, action-oriented labels in sentence case: “Cobrar,” “Crear nuevo
  puesto,” “Cerrar sesión.” No all-caps or Title Case buttons.
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
