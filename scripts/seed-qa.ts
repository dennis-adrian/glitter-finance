// Seeds (or refreshes) a QA account with dummy data against whatever environment
// the env vars point at — local, staging, or production. Unlike supabase/seed.sql
// (local-only, loaded by `supabase db reset`), this script is run manually and is
// safe to point at the cloud project.
//
// Required env:
//   NEXT_PUBLIC_SUPABASE_URL   target project URL
//   SUPABASE_SECRET_KEY        service (secret) key for the same project
//   DATABASE_URL               direct Postgres connection for the same project
//   QA_EMAIL                   login email for the QA account
//   QA_PASSWORD                login password for the QA account
//
// Usage:
//   QA_EMAIL=qa@glitterfinance.app QA_PASSWORD=... \
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... \
//   pnpm db:seed:qa               # seed if empty, otherwise leave data as-is
//   pnpm db:seed:qa -- --reset    # wipe the QA tenant's catalog, stock and sales, then reseed
//
// The three target variables come together from the command line, .env.local
// or .env (scripts/ops-env.ts). The script prints the target and, for a hosted
// project, asks for confirmation first; --yes skips the prompt.
//
// The auth user, tenant, and membership are always preserved (stable account);
// only the dummy catalog, stock movements and sales are affected by --reset.
// Other members of the QA tenant (helpers added with pnpm db:invite:tenant-user)
// are left alone.
// Must stay the first import: it loads the env before @/lib/db reads it.
import { opsEnvSource } from "./load-env";

import { and, eq, isNull } from "drizzle-orm";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { ensureMembership } from "@/lib/auth/memberships";
import { client, db } from "@/lib/db";
import {
  inventoryMovements,
  products,
  refunds,
  saleLines,
  sales,
  tenants,
} from "@/lib/db/schema";
import { createProductForTenant } from "@/lib/products/repository";
import {
  createSaleForTenant,
  refundSaleForTenant,
} from "@/lib/sales/repository";
import { findAuthUserByEmail } from "./admin-auth";
import { confirmOpsTarget } from "./ops-env";

// Stable identifiers so the QA account is recognizable and re-runs are idempotent.
const QA_TENANT_ID = "7a000000-0000-4000-8000-000000000001";
const QA_TENANT_NAME = "QA · Glitter Finance";
const QA_DISPLAY_NAME = "QA Tester";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// The app's lib/supabase/admin.ts is guarded with `import "server-only"`, which
// throws outside the Next.js server bundle. Construct an equivalent admin client
// here so this standalone script can run under plain Node/tsx.
function createAdminClient() {
  return createSupabaseClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      // supabase-js eagerly constructs a Realtime client; Node < 22 has no
      // global WebSocket, so provide `ws` as the transport. The script does not
      // use Realtime, but the constructor still requires one. The cast bridges
      // `ws`'s constructor signature to supabase's WebSocketLikeConstructor.
      realtime: { transport: ws as unknown as never },
    }
  );
}

async function findOrCreateAuthUser(email: string, password: string) {
  const admin = createAdminClient();

  const existing = await findAuthUserByEmail(admin, email);

  if (existing) {
    // Keep the documented password working even if the user already existed,
    // and (re)set app_metadata.tenant_id so PowerSync's sync rules can read
    // it from the JWT. Pre-existing QA users from before this script set
    // app_metadata get backfilled here.
    const { error: updateError } = await admin.auth.admin.updateUserById(
      existing.id,
      {
        password,
        app_metadata: {
          ...(existing.app_metadata ?? {}),
          tenant_id: QA_TENANT_ID,
        },
      }
    );
    if (updateError) {
      throw new Error(`Could not update QA user: ${updateError.message}`);
    }
    return { id: existing.id, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: QA_DISPLAY_NAME },
    // Set app_metadata.tenant_id at create time so the very first JWT
    // carries the claim. PowerSync's sync streams read it via
    // auth.parameters() -> 'app_metadata' ->> 'tenant_id'.
    app_metadata: { tenant_id: QA_TENANT_ID },
  });
  if (error || !data.user) {
    throw new Error(`Could not create QA user: ${error?.message ?? "unknown"}`);
  }
  return { id: data.user.id, created: true };
}

async function ensureTenant(userId: string) {
  await db
    .insert(tenants)
    .values({ id: QA_TENANT_ID, name: QA_TENANT_NAME, createdByUserId: userId })
    .onConflictDoNothing({ target: tenants.id });

  // Deleting the auth user clears the owner (ON DELETE SET NULL), so a
  // recreated QA user takes it back. An owner that still exists is kept.
  await db
    .update(tenants)
    .set({ createdByUserId: userId })
    .where(and(eq(tenants.id, QA_TENANT_ID), isNull(tenants.createdByUserId)));

  // Only the QA user's own membership. A deleted auth user's memberships are
  // already gone (ON DELETE CASCADE), and any other row on this tenant
  // belongs to a helper, which must keep its own membership.
  await ensureMembership(db, {
    tenantId: QA_TENANT_ID,
    userId,
    displayName: QA_DISPLAY_NAME,
  });
}

// Deletes only the QA tenant's catalog, stock movements and sales. FKs are ON
// DELETE RESTRICT, so children are removed before parents, and one
// transaction keeps a failure from leaving products without their sales. The
// direct db connection bypasses RLS, which is required because sales are
// otherwise immutable.
async function resetTenantData() {
  await db.transaction(async (tx) => {
    await tx
      .delete(inventoryMovements)
      .where(eq(inventoryMovements.tenantId, QA_TENANT_ID));
    await tx.delete(refunds).where(eq(refunds.tenantId, QA_TENANT_ID));
    await tx.delete(saleLines).where(eq(saleLines.tenantId, QA_TENANT_ID));
    await tx.delete(sales).where(eq(sales.tenantId, QA_TENANT_ID));
    await tx.delete(products).where(eq(products.tenantId, QA_TENANT_ID));
  });
}

async function seedData(userId: string) {
  // A product with stock tracking, so the QA account also covers stock
  // badges and the movement history. Its sales below take stock from it.
  const { product: sticker } = await createProductForTenant(
    QA_TENANT_ID,
    {
      name: "QA Sticker Pack",
      priceCents: 2000,
      costCents: 600,
      category: "Stickers",
      tracksInventory: true,
      lowStockThreshold: 5,
    },
    { userId, delta: 20 }
  );
  const restockedAt = new Date();
  await db.insert(inventoryMovements).values({
    tenantId: QA_TENANT_ID,
    productId: sticker.id,
    userId,
    delta: 10,
    reason: "restock",
    createdAt: restockedAt,
    clientCreatedAt: restockedAt,
  });
  const { product: print } = await createProductForTenant(QA_TENANT_ID, {
    name: "QA Art Print A4",
    priceCents: 5000,
    costCents: 1500,
    category: "Prints",
  });
  const { product: pin } = await createProductForTenant(QA_TENANT_ID, {
    name: "QA Enamel Pin",
    priceCents: 3500,
    costCents: null, // cost unknown — exercises the upper-bound net-earnings flag
    category: "Pines",
  });
  const { product: tote } = await createProductForTenant(QA_TENANT_ID, {
    name: "QA Tote Bag",
    priceCents: 8000,
    costCents: 3000,
    category: "Accesorios",
  });

  // An archived product to exercise catalog archive/restore views.
  const { product: keychain } = await createProductForTenant(QA_TENANT_ID, {
    name: "QA Keychain (archivado)",
    priceCents: 1500,
    costCents: 500,
    category: "Accesorios",
  });
  await db
    .update(products)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(products.id, keychain.id));

  // Completed sale, cash, no discount.
  await createSaleForTenant({
    saleId: crypto.randomUUID(),
    tenantId: QA_TENANT_ID,
    userId,
    userName: QA_DISPLAY_NAME,
    paymentMethod: "cash",
    saleDiscountCents: 0,
    lines: [
      { productId: sticker.id, quantity: 2 },
      { productId: print.id, quantity: 1 },
    ],
  });

  // Completed sale, QR, with a sale-level discount.
  await createSaleForTenant({
    saleId: crypto.randomUUID(),
    tenantId: QA_TENANT_ID,
    userId,
    userName: QA_DISPLAY_NAME,
    paymentMethod: "qr_transfer",
    saleDiscountCents: 500,
    saleDiscountReason: "QA descuento",
    lines: [{ productId: tote.id, quantity: 1 }],
  });

  // Voided sale. Set the void columns directly (service role) so we are not
  // blocked by the 10-minute void window the repository enforces.
  const toVoid = await createSaleForTenant({
    saleId: crypto.randomUUID(),
    tenantId: QA_TENANT_ID,
    userId,
    userName: QA_DISPLAY_NAME,
    paymentMethod: "cash",
    saleDiscountCents: 0,
    lines: [{ productId: pin.id, quantity: 1 }],
  });
  await db
    .update(sales)
    .set({ voidedAt: new Date(), voidedByUserId: userId })
    .where(eq(sales.id, toVoid.id));

  // Refunded sale. Refunds carry no time window, so the repository path works.
  const toRefund = await createSaleForTenant({
    saleId: crypto.randomUUID(),
    tenantId: QA_TENANT_ID,
    userId,
    userName: QA_DISPLAY_NAME,
    paymentMethod: "qr_transfer",
    saleDiscountCents: 0,
    lines: [{ productId: print.id, quantity: 1 }],
  });
  await refundSaleForTenant({
    tenantId: QA_TENANT_ID,
    userId,
    userName: QA_DISPLAY_NAME,
    saleId: toRefund.id,
    reason: "QA reembolso",
  });
}

async function main() {
  const reset = process.argv.includes("--reset");
  const email = requireEnv("QA_EMAIL");
  const password = requireEnv("QA_PASSWORD");

  await confirmOpsTarget(
    reset ? "reset and reseed the QA account" : "seed the QA account",
    opsEnvSource
  );

  const user = await findOrCreateAuthUser(email, password);
  console.log(`Auth user ${user.created ? "created" : "found"}: ${user.id}`);

  await ensureTenant(user.id);
  console.log(`Tenant ready: ${QA_TENANT_ID}`);

  if (reset) {
    await resetTenantData();
    console.log("Existing QA catalog, stock and sales wiped (--reset).");
  }

  const [existingProduct] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.tenantId, QA_TENANT_ID))
    .limit(1);

  if (existingProduct && !reset) {
    console.log(
      "QA tenant already has data; skipping seed. Use --reset to refresh."
    );
  } else {
    await seedData(user.id);
    console.log("Dummy catalog, stock and sales seeded.");
  }

  console.log("\nQA login:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
}

main()
  .then(async () => {
    await client.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("\nQA seed failed:");
    console.error(error instanceof Error ? error.message : error);
    await client.end().catch(() => {});
    process.exit(1);
  });
