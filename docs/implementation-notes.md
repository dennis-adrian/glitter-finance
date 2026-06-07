# Glitter POS Implementation Notes

## Current Slice

This first implementation is a local-first Stage A slice. It deliberately proves the high-frequency POS interaction before wiring in hosted infrastructure.

Implemented now:

- Mobile-first Next.js app shell.
- Persistent local product catalog, draft cart, and sales history.
- Sell Mode default landing screen.
- Tap product to add, long-press product to decrement.
- Cart review screen.
- Payment screen with sale-level discount presets and custom discount.
- Cash and QR payment methods.
- Immutable sales with snapshotted product price, cost, category, and quantity.
- Void and refund actions in reports.
- Basic reporting over today, week, and month.
- Supabase SSR client scaffolding, auth actions, callback route, and login page.
- Drizzle schema and Drizzle-journaled migrations in `supabase/migrations` for tenants, users, products, sales, sale lines, refunds, Supabase auth foreign keys, and RLS policies.

## Backend Boundary

The local store is intentionally shaped like the eventual sync model:

- Products, sales, sale lines, voids, and refunds use client-generated IDs.
- Committed sales are append-only.
- Sales snapshot price and cost at the time of sale.
- Draft carts are local-only and not represented as committed sales.

Supabase Auth, Drizzle schema, runtime Drizzle client, and RLS policies are scaffolded. Drizzle owns migration generation/tracking; the output folder is `supabase/migrations` to align with Supabase project structure. PowerSync, storage-backed image upload, and replacing the local Zustand store with synced reads/writes are the next infrastructure layer.

Tenant bootstrap is wired into the root app entry. An authenticated user is resolved through Supabase Auth; if they have no `tenant_users` membership, the server creates a tenant and membership row through Drizzle before rendering the POS. The UI still uses the local Zustand product/sales store until Supabase-backed product and sale repositories are connected.
