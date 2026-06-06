# Glitter Finance — Product Requirements Document

**Author:** Adrian Guzman
**Status:** Draft v1.12
**Date:** May 2026

---

## 1. Product Overview

Glitter Finance is an offline-first point-of-sale (POS) PWA for vendors at festivals and conventions in Bolivia. Its spine is the act of selling: a vendor taps products into a cart and charges the buyer in seconds. The vendor's first and most frequent need is to record a sale quickly and reliably, and to know at the end of the day what they made.

Festival vendors in Bolivia operate in a payment environment that off-the-shelf POS tools don't assume. There are no card readers. Payment is cash or QR transfer. WiFi at convention centers is unreliable, so the app works fully offline and syncs when connectivity returns. Glitter Finance is designed around that reality.

The product is positioned as part of the Glitter ecosystem alongside Glitter, Festicker, and Twinkler festival brands, and is intended both as a standalone tool for any Bolivian vendor and as a value-add offered to Glitter participants.

## 2. Goals and Non-Goals

**Goals**

The app lets a vendor record a sale fast enough to keep a queue moving while their hands are full and a buyer is waiting, against the concrete timing criteria in section 7.3. It works fully offline and syncs reliably when connectivity returns. It lets a vendor see how much they made over any period, including gross revenue, discounts given, cost of goods sold, and net earnings, without doing spreadsheet work.

**Non-Goals**

The app is not a full accounting system. It does not generate facturas or handle SIN compliance. It does not process payments itself, since cash and QR transfer happen out-of-band. It is not a general retail POS; it is built for the festival-booth context.

## 3. Scope at a Glance

Glitter Finance is a fast, offline-first POS with profit-aware reporting. It includes:

- A product catalog: name, price, cost, category, optional image.
- Sell Mode: a tappable product grid, an implicit cart, discounts, and a fast cash-or-QR checkout.
- Sales recorded against the account with a timestamp.
- Reporting over date ranges, including gross, discounts, cost of goods sold, and net earnings.
- Real accounts with multi-tenant data isolation and offline-first sync.
- Multiple users per account, so relatives or friends taking turns at a booth can each record sales from their own phone.

Capabilities planned for later (inventory tracking, events, QR labels and scanning, bundles, subscriptions, payment-proof attachments, expenses and full P&L, data export) are described in section 11, Future Features.

## 4. Rollout Strategy

Glitter Finance launches as a focused POS and grows from there.

**Closed testing.** The first user is Adrian. The app needs to be good enough to be the primary tool at a real Glitter-adjacent event before being shown to anyone else. Five initial testers, each with both an iPhone and an Android device, provide dual-platform validation throughout development. The build sequence and validation gates are detailed in section 10.

**Public beta.** Once the core is proven at a real event, the app opens to a wider set of vendors with self-serve sign-up and a public marketing site. The target user is an illustrator, crafter, or small artisan who sells at several events per year.

## 5. Core Concepts (Domain Model)

The model centers on four entities: Tenant, User, Product, and Sale (with sale lines). Keeping the model small is what makes the POS fast to build and reason about.

**Tenant (Account)**

An account representing one vendor or vendor team. Owns all products, sales, and users. The system is multi-tenant, with row-level security in Postgres enforcing isolation between accounts.

**User**

A person who can sign in and record sales on a tenant. A tenant can have multiple users, so relatives or friends who take turns at the booth can each use the app on their own phone. Every sale records the `user_id` that created it, enabling per-user attribution in reports. All users on a tenant have equivalent access; roles and permissions are a future feature.

**Product**

An item in the vendor's catalog. Fields: name, price, cost, category, and optional image. Price is what the buyer pays; cost is what the item costs the vendor to make or buy, used to compute net earnings. Products are a tappable, priced catalog.

**Sale**

A transaction recorded against the tenant with a timestamp, one or more line items, a payment method, and an optional sale-level discount. Sales are append-only and immutable: once committed, a sale is never edited or deleted. It can be voided within a short window (excluded from totals but retained) or reversed later by a refund. Reporting is by date range. Each sale records the `user_id` of whoever rang it up.

A **refund** is itself an append-only record that references an original sale and reverses it. The original sale is never altered. A refund carries its own timestamp and `user_id` and appears in reports as a negative amount in the period it was issued. The MVP supports full-sale refunds; partial refunds are a future feature.

Each **sale line** snapshots, at the moment of sale, the product's price and cost, the quantity, and any per-line discount, plus the resulting line total. Snapshotting both price and cost is essential: a sale must not change its revenue or its computed profit if the product's price or cost is later edited in the catalog. Historical profit reflects the price and cost as they were when the sale happened.

**Payment Method**

Two methods are supported: `cash` and `qr_transfer`. A QR transfer records that the method was QR. Vendors who want a record of a transfer use their phone camera or banking-app history; in-app payment-proof capture is a future feature.

## 6. User Stories

1. As a vendor, I want to add products with a name, price, optional cost, category, and optional image, so my catalog is ready to sell from.
2. As a vendor, I want to tap products into a cart and charge the buyer quickly, so I keep the queue moving.
3. As a vendor, I want to apply a discount to a whole sale or to a single line, so I can match the price I actually charge.
4. As a vendor, I want to mark a sale as paid by cash or QR transfer, so my records reflect how I was paid.
5. As a vendor, I want to void a just-made sale to fix an immediate mistake, and refund a past sale when a customer returns something, without ever deleting the original record.
6. As a vendor, I want to see what I made over a chosen period, including gross, discounts, cost of goods sold, and net, so I understand my earnings without a spreadsheet.
7. As a vendor with help at the booth, I want a relative or friend to record sales on the same account from their own phone, so we can take turns serving customers.

## 7. Functional Requirements

### 7.1 Product Catalog

Vendors create, edit, archive, and restore products. Each product has a name, price (Bs.), an optional cost (Bs.), a category, and an optional image. Price and cost are stored as integer cents (the smallest currency subdivision) and formatted to Bs. at the UI edges.

Cost is what enables net-earnings reporting, but it is optional and many vendors will leave it blank. A product with no cost recorded is treated as cost unknown rather than genuinely zero-cost. In calculations the unknown cost contributes zero, so net earnings still computes, but reports are honest that the figure is then an upper bound (see section 7.6). This keeps the catalog low-friction for vendors who don't track cost while not quietly overstating profit for those who fill it in partially.

Products are a tappable, priced catalog.

**Product images are optional and non-blocking.** A product image is always optional. The catalog and Sell Mode work fully without images; a product with no image renders a graceful placeholder (for example, the product's initial or a category glyph on a colored tile), never a broken-image icon or empty space. Images are uploaded at catalog-setup time, a calm moment with generally good connectivity, not mid-sale. If an image upload is pending or fails, the product is immediately usable and shows the placeholder until the image resolves; upload can be retried from the product editor. Once uploaded, images live in Supabase Storage and are fetched for display, with the device caching what it needs and falling back to the placeholder when an image is not yet available locally. The guiding rule: images enhance the experience but never gate it.

### 7.2 Sell Mode

Sell Mode is the highest-traffic screen and the one the design prioritizes. The screen is dominated by the product grid; the cart is not shown persistently, so the grid gets the full width. Layout principles:

- Large touch targets (minimum 56 px tap height).
- One-handed reachability on phones. The same layout is used on tablet, scaled up, rather than a separate cart-alongside layout, so there is one interaction model across devices.
- Product grid showing each product's image (or placeholder), name, and price. Filterable by category.
- Each product tile that is currently in the cart shows a small quantity tag (a badge with the count of that product in the cart), so the vendor sees at a glance what has been added without opening the cart.
- Grid tile interaction: tapping a tile adds one of that product to the cart; tapping and holding a tile removes one (decrements by one). Both update the tile's quantity tag, the order icon's count badge, and the live total under the Cobrar button immediately. This lets the vendor add and correct entirely from the grid without opening the cart.
- An order icon button (Lucide `scroll-text`, next to the Cobrar button) opens the cart view for review and fine-tuning. The icon carries a badge with the total item count. Opening the cart is optional, not required to check out.
- A large, always-visible **"Cobrar"** button is fixed at the bottom of the Sell Mode screen. It is disabled while the cart is empty and becomes enabled the moment the first item is added. Its label reads "Cobrar," and directly below in a smaller font it shows, updating in real time, the amount that will be charged. Tapping it goes to the payment screen.
- The cart view (opened from the order icon) shows the current sale lines, per-line quantity controls (-, +) and one-tap remove, the total, and its own "Cobrar" button so the vendor can charge directly after reviewing the order. It is a review surface, not a required step; the same Cobrar action exists on the main Sell Mode screen.

The sale flow (the cart is implicit; Sell Mode always opens with an empty cart):

1. Add items by tapping products in the grid; each tap adds one and increments the tile's quantity tag. Tap and hold a tile to remove one. The Cobrar button enables on the first item, and the live amount beneath it updates with every change. The first item added brings the current sale into existence; no explicit "begin" action is required.
2. Optionally open the cart (order icon) to review lines, fine-tune quantities, or remove lines. The cart view has its own Cobrar button, so the vendor can charge from there too. Not required to check out.
3. Tap "Cobrar" (from the main screen or the cart view) to go to the payment screen.
4. On the payment screen, optionally apply a discount (see section 7.4), then select cash or QR transfer. Selecting the method immediately commits the sale and returns to Sell Mode: the cart empties, the grid tags clear, and a brief non-blocking toast confirms the sale (e.g. "Venta registrada · 45 Bs · Efectivo"). The toast auto-dismisses after a couple of seconds and does not block starting the next sale; tapping any product dismisses it and begins the next sale.

An explicit "clear cart" affordance (in the cart view) abandons an in-progress sale when a buyer walks away, discarding the uncommitted cart without recording anything.

**The in-progress cart persists.** An uncommitted cart is a durable draft, not transient state. It survives navigating to other screens, backgrounding the app, opening other apps, and long idle periods (hours later, the cart is still there). It is cleared only by charging it (which turns it into a committed sale) or by the explicit clear-cart action. A draft older than 24 hours is discarded on launch, so a forgotten cart from a previous event does not resurface mid-next-event.

This must not slow down tapping. Persistence is kept entirely off the tap critical path:

- Tapping a product updates the in-memory cart state synchronously and the UI re-renders instantly. The tap never waits on storage, so the vendor can tap as fast as they can and every item registers immediately.
- The cart is written to durable on-device storage (a local-only draft table in the same SQLite store PowerSync uses, not synced to the server since an uncommitted cart is not yet a sale) asynchronously: a debounced background write while the vendor is active (rapid taps collapse into a single write of the final state), plus a forced flush on background/visibility-change events so nothing is lost when the app is suspended.
- On launch, the cart rehydrates from durable storage into in-memory state.

The only residual loss window is a hard app-kill in the sub-second gap between the last tap and the next debounced flush; the background-event flush shrinks this to near-zero for normal cases (backgrounding, navigating away), and for a draft cart that residual risk is acceptable.

**Sales are immutable: void or refund, never delete.** A committed sale is a permanent record and cannot be deleted. Corrections are made by recording, not erasing, so totals and history stay trustworthy and auditable, and so offline sync never has to reconcile deletions. Two mechanisms cover the two situations:

- **Void** handles an immediate mistake (wrong item, double-tap, mistyped discount). Within 10 minutes of completing a sale, the vendor can void it from the recent-sales list. A voided sale is kept for the audit trail and excluded from totals. Void is for the moment right after a sale, typically before the customer has left.
- **Refund** handles a completed sale that needs reversing later (a returned product, or a problem found after the void window has closed). A refund is itself a recorded transaction that references the original sale; the original is never altered. Refunds are append-only like sales and appear in reports as negative amounts against the period in which the refund was issued.

The MVP supports full-sale refunds (reversing an entire sale). Partial refunds (reversing specific lines or quantities) are a future refinement (section 11).

**Checkout commits immediately.** Selecting the payment method commits the sale and returns to Sell Mode in one action, with no blocking confirmation step or modal. Confirmation is a brief non-blocking toast showing the amount and payment method, which auto-dismisses and never sits in front of the next sale. The guiding rule is "charge, done, next customer."

Products are always sellable; there is no stock count and no out-of-stock state. (Inventory tracking, when added, preserves this by never blocking a sale; see section 11.)

### 7.3 Sell Mode Performance Acceptance Criteria

The speed goal is made concrete with timed scenarios. Each measures vendor-app interaction time only: the clock starts when the vendor begins the action on an already-open, warm Sell Mode (app in Sell Mode, empty cart) and stops when the sale is committed and the app is ready for the next customer. The timing excludes things outside the app's control, such as the buyer finding cash or the QR transfer clearing on the buyer's own bank app. Targets assume a mid-range Android device and an equivalent iPhone, since both platforms are first-class.

Acceptance scenarios (warm Sell Mode, tap selection). Checkout is reached directly via the always-visible Cobrar button; the order icon is not on the critical path:

- **Single item, cash:** tap 1 product, tap Cobrar, select cash. Committed in under 4 seconds.
- **Two items, QR:** tap 2 products, tap Cobrar, select QR transfer. Committed in under 5 seconds.
- **Five items, cash, with one whole-sale discount applied:** tap 5 products, tap Cobrar, tap a discount preset, select cash. Committed in under 11 seconds.

Supporting latency budgets these scenarios depend on:

- **Adding a product to the cart (tap to visible tag/badge and live-total update):** under 200 ms.
- **Cobrar to payment screen:** under 200 ms.
- **Payment-method selection to committed and cart-cleared:** under 300 ms (a local write; no network in the critical path).

These are validated on real devices, on both a mid-range Android and an iPhone. A scenario failing its target on either platform is a release blocker, not a polish item.

### 7.4 Discounts

Two discount mechanics exist, modeled separately:

1. **Sale-level discount.** Applied to the whole sale at the vendor's discretion (regular customer, cash round-up, last item on the table, friendly gesture). Recorded on the sale header.
2. **Per-line discount.** Applied to a single line item (a slightly damaged product sold for less). Recorded on that sale line only.

Sale-level discount lives on the payment screen (the screen reached by tapping Cobrar), alongside the payment-method choice, since applying a discount and taking payment are one connected moment. It offers four quick options plus the amount:

```
Total:           150 Bs

Descuento:   [ 2 Bs ] [ 5 Bs ] [ 10 Bs ] [ Otro ]

Pago:        [ Efectivo ]   [ QR ]
```

The presets 2 Bs, 5 Bs, and 10 Bs apply that absolute amount off in one tap. "Otro" opens a custom input supporting both an absolute amount and a percentage; a percentage resolves to an absolute cents value at the moment it is applied, so the sale record is unambiguous about the amount discounted. Applying a discount updates the displayed total in real time before the vendor selects a payment method.

Per-line discounts are a secondary action tucked into a line item options sheet in the cart view (long-press or swipe on a cart line), since they are less common than a whole-sale discount. The same absolute-or-percentage input applies.

Discount reasons are optional free text.

### 7.5 Multiple Users per Account

A tenant can have multiple users, so relatives or friends taking turns at a booth can each record sales from their own phone.

- Multiple users belong to one tenant. Each installs the app and signs in with their own credentials.
- Each user records sales against the shared tenant. All sales roll up into the same reports.
- Every sale carries the `user_id` of whoever rang it up, so reports can break down who sold what.

Because each sale is independent and append-only with a client-generated UUID, two people selling on the same account at the same time produce sales that both sync without any conflict to resolve.

Roles and permissions, per-user restricted views, invite-and-revoke flows, and real-time propagation (seeing another user's sale appear instantly) are future features (section 11). The core is that more than one person can ring up sales on the same account, and reports attribute each sale.

### 7.6 Reports

Reports are computed over a chosen date range (today, this week, this month, or a custom range).

A report over a range shows:

- **Gross revenue** (sum of line subtotals before discounts).
- **Discounts given** (sale-level plus line-level).
- **Net revenue** (what was actually charged).
- **Cost of goods sold** (sum of snapshotted line costs × quantities).
- **Net earnings** (net revenue minus cost of goods sold).
- Total transactions, average ticket, breakdown by payment method, breakdown by category, units sold per product, and best sellers.
- A breakdown by user (who sold what).
- Refunds issued in the range, applied as negative amounts so revenue and net earnings reflect them.

The gross / discounts / net / cost / net-earnings figures are the heart of the reporting value: a vendor sees not just what they took in but what they actually earned after the cost of their goods.

Because cost is optional, cost of goods sold and net earnings can be based on incomplete data. When any product sold in the range has no recorded cost, the report marks cost of goods sold as incomplete and presents net earnings as an upper bound (true profit is at most this figure), rather than showing a confidently wrong number. A vendor who records cost on all their products gets exact figures; one who records none still gets accurate gross/discounts/net with net earnings clearly flagged as not accounting for cost.

Reports are viewed in-app over the selected date range. Exporting report or sales data to a file is a future feature (section 11).

## 8. Screens and Flows

The app opens directly into Sell Mode; there is no separate home or dashboard. A persistent bottom navigation bar gives one-tap access to the main areas (Sell, Reports, Catalog, Settings), with Sell as the default. This keeps the vendor's primary task, ringing up a sale, immediately in front of them on launch.

- **Auth:** sign up, log in, password reset.
- **Onboarding:** brief walkthrough leading to adding the first product, then into Sell Mode.
- **Sell Mode (default landing screen):** the core sales UI, a full-width product grid (tap to add, tap-and-hold to remove) with per-tile quantity tags, an order icon, and a fixed-bottom "Cobrar" button showing the live total (section 7.2).
- **Cart view:** opened from the order icon; a review surface showing current sale lines, quantity controls, remove, total, a "Cobrar" button, and clear-cart. Not required to check out.
- **Payment screen:** reached by tapping Cobrar; sale-level discount (2 / 5 / 10 Bs presets plus "Otro") and payment-method selection (Efectivo / QR). Selecting a method commits the sale.
- **Product Catalog:** list, search, filter, create, edit, archive.
- **Product Detail / Edit:** name, price, optional cost, category, optional image.
- **Recent Sales / Sale Detail:** reached from Reports; a list of recent sales where opening one shows its lines and totals, with void (within the window) or refund actions.
- **Reports:** date-range selector and the figures in section 7.6.
- **Settings:** account, users on the account, sign out.
- **Diagnostics (tester-only):** sync queue depth, last sync timestamp, online/offline status, device info, "force sync now" button.

Tablet uses the same single-screen Sell Mode as phones, scaled up with more grid columns; the cart is reached via the order icon on both. Everything else is mobile-first single column.

## 9. Sync and Offline Strategy

The app is offline-first using **PowerSync** as the sync engine between Supabase Postgres and a local SQLite database (running in the browser via WASM) on each device. Every device's UI reads from the local SQLite store, so reads never touch the network. Mutations are written locally first and replicated to Postgres in the background.

**Conflict resolution principles**

- **Sales and refunds are append-only.** Each carries a client-generated UUID, so a replayed or duplicated sync operation never creates a duplicate, and two users on the same account (or one user on two devices) recording at the same time never collide. Nothing is ever deleted; a void marks a sale excluded-from-totals, and a refund is a new record referencing the original.
- **Product edits use last-write-wins** with a timestamp.

**Sync status visibility**

The app surfaces sync state so the vendor always knows whether their sales have reached the cloud. A small persistent indicator shows pending mutation count and last successful sync timestamp. A tester-only diagnostics screen shows the full sync state for bug reports.

**iOS Safari considerations**

PowerSync's web SDK on iOS Safari uses the OPFSCoopSyncVFS storage backend (rather than the default IndexedDB-backed VFS) for better stability, configured from the moment PowerSync is wired in. iOS is a primary validation target throughout: a feature is "done" only when it works on iOS Safari installed PWA and Android Chrome installed PWA, not when it works on one.

**Data retention**

All sales and products stay on the device and in the cloud indefinitely.

## 10. Build Sequence and Validation

The build is sequenced so the core sell-and-track loop is proven before harder technical layers are added around it. The whole sequence uses the real account system from the start: Supabase Auth, real `tenant_id` scoping, and PowerSync sync rules keyed on the authenticated user. Public self-serve registration arrives with the public beta; during closed testing, testers are provisioned by manual invite.

**Stage A — Core POS loop (local-first).** The data model (tenant, user, product, sale with discounts and price/cost snapshotting). Catalog management, Sell Mode with tap selection, cash and QR payment, void-within-window. Real auth and tenancy in place. Sync in this stage assumes a generally-online developer environment; the data path is final (same tables, tenant model, and PowerSync-backed schema as production) while the resilience around it is hardened in Stage B. Checkpoint: a small, low-stakes personal real-use test (Adrian using it at one event) to confirm the sell loop feels right.

**Stage B — Offline and sync hardening.** PowerSync wired in properly. Sync status visibility and the tester-only diagnostics screen. Retry and backoff. Deliberate offline scenario testing (airplane mode, record sales offline, reconnect and confirm they reach the cloud). The OPFSCoopSyncVFS iOS configuration and serious iOS Safari testing across all five testers' devices. Goal: the app is trustworthy when connectivity is bad.

**Stage C — Reporting.** The date-range reporting feature (section 7.6), including gross, discounts, net, cost of goods sold, and net earnings. Gate: full multi-tester real-event validation. The core is not considered complete until the app has been used as the primary sales tool at a real festival, by Adrian, with at least one tester also using it at a separate event.

**Stage D — Multiple users per account.** Multiple users on one tenant, each recording sales from their own device, with per-user attribution surfaced in reports (section 7.5). Sequenced after reporting so the by-user report dimension is added to reports that already exist. The public beta can open before or after this stage.

## 11. Future Features

Capabilities planned beyond the initial release. They are documented here so the data model is built without precluding them.

### 11.1 Inventory tracking (optional per product)

A vendor will be able to opt a product into inventory tracking. Tracked products carry a stock count; untracked products behave as they do today (no count, always sellable). When tracking is on, sales decrement stock and the product can surface low/out-of-stock states.

A sale is never blocked by a stock disagreement. Selling a tracked product with insufficient stock shows an out-of-stock visual state, prompts a "sell anyway?" confirmation, and on confirmation records the sale and lets stock go negative, flagging the product `oversold` for later reconciliation. A buyer at the booth always takes priority over a bookkeeping count.

### 11.2 Warehouse / global inventory

A tenant-level global stock of products, adjustable with journaled reasons (received, lost, gifted, correction), from which event inventory is later drawn. Meaningful once inventory tracking exists.

### 11.3 Events

A festival or convention as a first-class object (name, location, dates, lifecycle state) that sales can attach to, with inventory loaded from the warehouse into an event and leftovers returned on close. Reporting would then offer per-event summaries and cross-event comparison (revenue, discounts, transactions, best sellers across selected events). Date-range reporting remains the baseline; events layer on top without changing the sale model.

### 11.4 QR labels and scanning

Generating printable QR labels for products (the product's UUID encoded, client-side PDF via jspdf) and an in-app QR scanner (html5-qrcode, QR-only, batch-scan, pre-warmed camera, 640×480) to add products to a sale by scanning, with a just-in-time camera-permission flow. Selling relies on tap selection until this ships.

### 11.5 Bundles

A priced combo that, when sold, decrements multiple component products. A bundle is essentially an inventory-decrement mechanism, so it arrives with inventory tracking. Until then, something like "5 stickers for 20 Bs" is modeled as its own product priced at 20.

### 11.6 Multi-user roles and refinements

Roles and permissions, per-user restricted views, invite-and-revoke flows, and real-time propagation so one user sees another's sale appear instantly.

### 11.7 Payment-proof attachments

Attaching a QR confirmation screenshot to a sale. The intended design: screenshots upload through a separate, durable queue to Supabase Storage independent of PowerSync row sync; a sale references an attachment by ID (never a direct URL) so the sale row is final at creation time and the image resolves later; attachments carry their own lifecycle (`pending_local` → `uploading` → `uploaded`, with `failed` retry and a terminal `unavailable`); the cloud copy is the system of record while the device keeps only `pending_local` bytes until upload, then thumbnails, fetching full images on demand; reports always show the sale regardless of attachment state. This keeps the feature from ever blocking checkout or compromising financial records.

### 11.8 Provider attribution for QR transfers

Detecting which QR provider (BCP Simple, Tigo Money, etc.) a transfer used, likely via screenshot OCR or pattern recognition. Depends on payment-proof attachments.

### 11.9 Expenses and full P&L

Recording expenses against a period or event (table fee, transport, supplies, food, miscellaneous) to produce a complete profit-and-loss view. Cost-of-goods-sold reporting is a step toward this; full P&L adds operating expenses beyond the cost of goods.

### 11.10 Subscriptions and billing, and the Glitter festival add-on

A freemium model with a paid subscription, plus offering Glitter Finance as a paid add-on during Glitter, Festicker, and Twinkler registration. Reference target shape: a free tier with caps and a paid tier around 50 Bs/month (numbers to be set against real usage). Initial billing would use a manual QR-transfer payment flow with admin approval, automated later. The festival add-on is opt-in and paid, provisioned automatically when added at registration.

### 11.11 Native apps

Optional native Expo apps if the audience wants store-distributed apps. The backend stays the same; only the client changes.

### 11.12 Partial refunds

Reversing specific lines or quantities of a sale rather than the whole sale. The refund record references the original sale's specific lines and the quantities being returned. Builds on the full-sale refund model already in place.

### 11.13 Data export

Exporting sales and report data to a file (CSV at minimum) so a vendor can keep their own records or hand data to an accountant. Likely one row per sale line (timestamp, product, quantity, snapshotted unit price and cost, line discount, payment method, recording user) and one row per sale, with refunds as their own rows, over a selected date range. A broader account-level export (everything, for portability or backup) is a related possibility.

## 12. Technical Architecture

### 12.1 Stack Summary

**Frontend**

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS 4 + shadcn/ui for components
- Serwist for the PWA service worker
- react-hook-form + Zod for forms and validation
- Zustand for client-side state
- Recharts for report visualizations
- Lucide React (lucide.dev) as the icon set

All libraries are pinned to their latest stable versions at project start and kept current thereafter, unless a specific version is called out (as with Next.js 16 and Tailwind CSS 4).

**Brand**

- Primary color: `#6822E2`. Applied through the Tailwind 4 theme and the shadcn/ui token set so it propagates consistently across components.

**Backend**

- Supabase (hosted) providing Postgres + Auth + Storage
- Drizzle ORM for schema definition, migrations, and queries
- `@powersync/drizzle-driver` for Drizzle against the client-side SQLite store

**Offline / sync**

- PowerSync as the sync engine between Supabase Postgres and per-device SQLite
- PowerSync Web SDK on the client, OPFSCoopSyncVFS storage backend
- Local SQLite database via WASM in the browser

**Infrastructure**

- Vercel for hosting the Next.js app
- PowerSync Cloud
- Supabase managed Postgres
- PostHog for product analytics
- Sentry for error tracking

**Locale and formatting**

- Spanish only (no i18n setup)
- Currency (price and cost) stored as integer cents, formatted to Bs. at the UI edges
- All timestamps stored in UTC (Postgres `timestamptz`); server-side and sync logic operate in UTC. Conversion to Bolivia time (UTC−4, no daylight saving) happens only at the UI edge when formatting for display.
- Report date ranges are timezone-aware: "today," "this week," and "this month" are computed against Bolivia day boundaries (midnight-to-midnight Bolivia time) and translated to the corresponding UTC range for querying, so daily totals are correct regardless of UTC offset.

### 12.2 PowerSync Plan

The PowerSync free tier covers closed testing: 2 GB synced per month, 500 MB hosted, 50 concurrent connections, 2 service instances. The free tier deactivates projects after 7 days of inactivity, acceptable during personal-use testing. The Pro tier ($49/month) starts when usage requires it, providing higher limits and no inactivity-based deactivation. A source-available self-hosted "Open Edition" exists as a credible escape hatch if cloud costs ever become prohibitive.

### 12.3 Authentication

Supabase Auth handles email/password sign-up and sign-in. No OAuth providers initially. Row-level security policies in Supabase Postgres enforce tenant isolation independently of client-side checks, which also cleanly supports multiple users on one tenant.

## 13. UI Design Approach

Glitter Finance is built without a dedicated designer. UI work is done iteratively with AI coding agents (Claude Code and similar), with Adrian supervising design decisions and reviewing output. Three structural supports make this work:

**Design system: shadcn/ui.** All components compose from a consistent library, giving AI agents a predictable vocabulary and producing visual coherence by default.

**UI style guide document.** Produced once early and used as context for every UI prompt thereafter. Covers touch-target minimums (56 px), spacing scale, color usage, when to use modals vs drawers vs full screens, loading states, error states, and Sell Mode layout rules. Treated as the authoritative reference and updated as the design evolves.

**Deliberate Sell Mode design pass before backend integration.** Touch-optimized POS interfaces are unforgiving, so Sell Mode mockups are reviewed and iterated with the AI before sync wiring goes in. Other screens are built more iteratively.

## 14. Testing Strategy

**Dual-platform testing from day one.** Adrian and each of the five testers have both an iPhone and an Android device. iOS is a primary validation target; a feature is "done" only when it works on iOS Safari installed PWA and Android Chrome installed PWA.

**Timed Sell Mode performance scenarios.** The acceptance criteria in section 7.3 are run as explicit timed tests on real devices, on both a mid-range Android and an iPhone. A miss on either platform is a release blocker.

**Scripted offline and sync scenarios.** Testers run scenarios that stress offline-first behavior: enter Sell Mode, airplane mode, record sales offline, confirm they appear immediately in the local UI with the sync indicator showing them pending, then restore connectivity and confirm they reach the cloud and the indicator clears. A secondary scenario uses two devices on the same account to confirm sales made on one appear on the other.

**Tester-only diagnostics screen.** Shows sync queue depth, last sync timestamp, online/offline status, device info, and a "force sync now" button. Testers screenshot it with bug reports.

**Structured weekly feedback rhythm.** A simple weekly form: what was tested, what worked, what didn't, diagnostics screenshot if something broke.

**Real-event validation.** A small personal test at the end of Stage A validates the core loop before the harder layers are built. The full multi-tester festival validation is the gate at the end of Stage C.

## 15. Settled Decisions

- **Product framing:** Glitter Finance is a POS first. Selling is the spine; reporting and multi-user round out the initial release.
- **Product name:** Glitter Finance.
- **Platform:** PWA. Native Expo apps optional later.
- **Backend:** Supabase. **Offline/sync:** PowerSync. **ORM:** Drizzle (server-side Postgres and client-side SQLite).
- **Frontend stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, Serwist, react-hook-form, Zod, Zustand, Recharts. Icons: Lucide React (the order/cart entry uses `scroll-text`). Libraries kept on their latest stable versions unless pinned (Next 16, Tailwind 4).
- **Brand:** primary color `#6822E2`, applied via the Tailwind 4 theme and shadcn/ui tokens.
- **Hosting:** Vercel. **Telemetry:** PostHog (analytics) and Sentry (errors).
- **Locale:** Spanish only. Money (price and cost) stored as integer cents.
- **Timestamps:** stored in UTC (Postgres `timestamptz`), converted to Bolivia time (UTC−4) only at the UI edge. Report date ranges are computed against Bolivia day boundaries, not UTC.
- **Sales model:** sales attach to the tenant with a timestamp; reporting is date-range based.
- **Cost field:** optional per product; when recorded, snapshotted on the sale line alongside price so historical profit reflects the cost at time of sale. Missing cost is treated as unknown (contributes zero to calculations), and reports flag net earnings as an upper bound when any sold product lacks a cost.
- **Sale immutability:** a committed sale is never edited or deleted. An immediate mistake is handled by void within a 10-minute window (retained, excluded from totals); a later reversal is a refund, an append-only record referencing the original sale and shown as a negative amount. Full-sale refunds in the MVP; partial refunds are a future feature.
- **Reports:** show gross, discounts, net, cost of goods sold, and net earnings over a date range, plus breakdowns. Viewed in-app; data export is a future feature.
- **Discounts:** sale-level (on the payment screen, with 2 / 5 / 10 Bs presets plus "Otro" for a custom absolute or percentage amount) and per-line (in the cart view). Percentages resolve to an absolute cents amount at apply time.
- **Navigation:** the app opens directly into Sell Mode (no home or dashboard screen); a persistent bottom nav gives one-tap access to Sell, Reports, Catalog, and Settings.
- **Draft cart persistence:** an uncommitted cart is durable; it survives navigation, backgrounding, and long idle periods, and is cleared only by charging or explicit clear-cart (with a 24-hour age-out on launch). Persistence is off the tap critical path: instant in-memory updates, debounced async writes to a local-only SQLite draft table plus a flush on background/visibility-change, so tapping is never blocked by storage.
- **Cart presentation and grid gestures:** the cart is not shown persistently. The product grid fills the screen; tapping a tile adds one of that product and tapping-and-holding removes one, with each in-cart tile showing a quantity tag. A fixed-bottom "Cobrar" button (enabled once the cart is non-empty) shows the live total and is the direct path to checkout; the cart view (opened via the order icon beside it) also has its own Cobrar button so the vendor can charge after reviewing. No "Start Sale" step; the first tapped item begins the sale; an explicit "clear cart" in the cart view abandons an in-progress sale.
- **Checkout:** commits immediately on payment-method selection and returns to Sell Mode. Confirmation is a brief non-blocking toast (amount and payment method), not a dedicated confirmation screen, to keep the hot path fast.
- **Sell Mode speed:** defined by concrete timed acceptance scenarios in section 7.3, measured vendor-app interaction time only, on a warm Sell Mode, on both Android and iPhone. A miss on either platform is a release blocker.
- **Product images:** optional and non-blocking, uploaded at catalog-setup time, with graceful placeholders.
- **Multiple users per account:** included. Multiple users per tenant recording independent sales with per-user attribution. Roles, permissions, restricted views, invites, and real-time propagation are future features.
- **Authentication:** Supabase Auth, real tenant scoping, PowerSync sync rules keyed on the authenticated user. Public self-serve sign-up arrives with the public beta; testers provisioned by manual invite during closed testing.
- **iOS as a primary validation target:** OPFSCoopSyncVFS configured from the moment PowerSync is wired in.
- **No designer:** AI-assisted UI work with a style guide document and a deliberate Sell Mode design pass.

## 16. Open Items

These don't block schema design or build planning and can be settled as their relevant features come up:

1. **Domain name.** glitterfinance.bo, glitterfinance.app, finance.glitter.bo (subdomain), or something else.
2. **PowerSync free-tier inactivity workaround during closed testing.** Accept reactivation friction, or set up a weekly ping to keep the project warm.
3. **Sell Mode numeric entry for discounts.** Custom numeric pad, native numeric keyboard, or stepper buttons. Affects how fast discount entry feels.
4. **Receipt sharing.** Whether to offer "send receipt via WhatsApp" at sale completion, or treat it as out of scope.
5. **Scope of data export when it ships.** Per-period sales export, full account-level export for portability/backup, or both, and in what formats. (Export itself is a future feature; this is about its eventual shape.)
6. **Public-beta timing relative to Stage D (multiple users).** Open the beta before or after multi-user ships.

---

*End of document.*
