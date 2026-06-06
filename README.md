# Glitter POS

Offline-first point-of-sale PWA for Bolivian festival vendors.

This repository currently implements the Stage A product slice from the PRD:

- Product catalog with categories, optional cost, archive/restore, and graceful image placeholders.
- Sell Mode as the default screen with tappable product grid, quantity badges, draft cart persistence, and a fixed Cobrar action.
- Cart review surface with quantity controls and clear-cart.
- Payment screen with sale-level discounts and cash/QR checkout.
- Immutable local sales with snapshotted price/cost data, recent sales, voids, refunds, and basic reports.
- Local persistence using browser storage through Zustand, ready to be replaced by PowerSync-backed SQLite.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Product docs

The PRD lives in [`docs/glitter-finance-prd.md`](docs/glitter-finance-prd.md).
