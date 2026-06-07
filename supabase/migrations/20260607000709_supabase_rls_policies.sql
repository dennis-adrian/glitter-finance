-- Supabase Auth foreign keys. Drizzle does not model the `auth.users` table,
-- so the user_id columns are declared as plain uuid in the schema and given
-- their referential integrity here.
ALTER TABLE "tenant_users"
  ADD CONSTRAINT "tenant_users_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_voided_by_user_id_auth_users_id_fk"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict;
--> statement-breakpoint

-- Domain check constraints. Money and quantities are non-negative; line items
-- always have positive quantity. The void columns are coupled: either both
-- set or both null, never a half-voided row.
ALTER TABLE "products"
  ADD CONSTRAINT "products_price_cents_nonnegative_check" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "products_cost_cents_nonnegative_check" CHECK ("cost_cents" IS NULL OR "cost_cents" >= 0);
--> statement-breakpoint
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_discount_cents_nonnegative_check" CHECK ("sale_discount_cents" >= 0),
  ADD CONSTRAINT "sales_void_coherence_check" CHECK (
    ("voided_at" IS NULL AND "voided_by_user_id" IS NULL)
    OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_quantity_positive_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sale_lines_unit_price_cents_nonnegative_check" CHECK ("unit_price_cents" >= 0),
  ADD CONSTRAINT "sale_lines_unit_cost_cents_nonnegative_check" CHECK ("unit_cost_cents" IS NULL OR "unit_cost_cents" >= 0),
  ADD CONSTRAINT "sale_lines_discount_cents_nonnegative_check" CHECK ("line_discount_cents" >= 0),
  ADD CONSTRAINT "sale_lines_total_cents_nonnegative_check" CHECK ("line_total_cents" >= 0);
--> statement-breakpoint

-- Enable row level security on every domain table. The policies below grant
-- back only what tenant members are allowed to do.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Membership helper. SECURITY DEFINER avoids RLS recursion when policies on
-- one table need to consult tenant_users to authorize the caller.
CREATE OR REPLACE FUNCTION "public"."current_user_has_tenant"("target_tenant_id" uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_users
    WHERE tenant_users.tenant_id = target_tenant_id
      AND tenant_users.user_id = auth.uid()
  );
$$;
--> statement-breakpoint

-- Tenant + membership read access. A user may read their own membership rows
-- (so they can discover their tenant on sign-in) plus everything scoped to a
-- tenant they belong to.
CREATE POLICY "tenant members can read tenants"
ON "tenants" FOR SELECT
USING ("public"."current_user_has_tenant"("id"));
--> statement-breakpoint
CREATE POLICY "tenant members can read tenant users"
ON "tenant_users" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
CREATE POLICY "users can read their own memberships"
ON "tenant_users" FOR SELECT
USING ("user_id" = auth.uid());
--> statement-breakpoint

-- Products are mutable inside the tenant. Last-write-wins via updated_at is
-- enforced by the application, not by the database.
CREATE POLICY "tenant members can read products"
ON "products" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
CREATE POLICY "tenant members can insert products"
ON "products" FOR INSERT
WITH CHECK ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
CREATE POLICY "tenant members can update products"
ON "products" FOR UPDATE
USING ("public"."current_user_has_tenant"("tenant_id"))
WITH CHECK ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint

-- Sales are append-only with a single allowed mutation: voiding. The defense
-- is layered.
--
-- Layer 1: column-level UPDATE GRANT. The `authenticated` role may only
-- UPDATE the two void columns. Any attempt to change another column fails at
-- the Postgres permissions layer before RLS even runs.
--
-- Layer 2: RLS USING clause restricts UPDATE to rows that are not yet voided,
-- so a voided sale can never be un-voided or re-voided.
--
-- Layer 3: RLS WITH CHECK forces the resulting row state to be voided and
-- self-attributed to the calling user. The matching CHECK constraint on the
-- table ensures voided_at and voided_by_user_id are always set together.
CREATE POLICY "tenant members can read sales"
ON "sales" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
CREATE POLICY "tenant members can insert sales"
ON "sales" FOR INSERT
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "user_id" = auth.uid()
  AND "voided_at" IS NULL
  AND "voided_by_user_id" IS NULL
);
--> statement-breakpoint
REVOKE UPDATE ON "sales" FROM authenticated;
--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by_user_id") ON "sales" TO authenticated;
--> statement-breakpoint
CREATE POLICY "tenant members can void sales"
ON "sales" FOR UPDATE
USING (
  "public"."current_user_has_tenant"("tenant_id")
  AND "voided_at" IS NULL
)
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "voided_at" IS NOT NULL
  AND "voided_by_user_id" = auth.uid()
);
--> statement-breakpoint

-- Composite foreign key so a sale_line cannot be attached to a sale that
-- lives in a different tenant. The single-column FK from the initial migration
-- only enforced "sale_id exists," which leaves room for a user with membership
-- in two tenants to attach a line in tenant B to a sale in tenant A. Postgres
-- requires the FK target columns to be UNIQUE, so we first add a UNIQUE
-- constraint on (id, tenant_id) of sales — id alone is already the primary key
-- so this is a no-op uniqueness-wise, but it makes the composite FK legal.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_id_tenant_id_unique" UNIQUE ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "sale_lines"
  DROP CONSTRAINT "sale_lines_sale_id_sales_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_sale_id_tenant_id_sales_id_tenant_id_fk"
  FOREIGN KEY ("sale_id", "tenant_id")
  REFERENCES "sales" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint

-- Sale lines are append-only. No UPDATE or DELETE policy is declared, which
-- denies those operations under RLS. The composite FK above guarantees the
-- tenant_id on each line matches the parent sale's tenant_id, so a malicious
-- caller cannot smuggle a line into the wrong tenant scope.
CREATE POLICY "tenant members can read sale lines"
ON "sale_lines" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
CREATE POLICY "tenant members can insert sale lines"
ON "sale_lines" FOR INSERT
WITH CHECK ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint

-- Composite foreign key so a refund cannot be attached to a sale that lives
-- in a different tenant. Same pattern as sale_lines above: the original
-- single-column FK only enforced "original_sale_id exists," which leaves room
-- for a user with membership in two tenants to file a refund under tenant B
-- against a sale that lives in tenant A. The sales_id_tenant_id_unique
-- constraint added above makes the composite FK target legal.
ALTER TABLE "refunds"
  DROP CONSTRAINT "refunds_original_sale_id_sales_id_fk";
--> statement-breakpoint
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_original_sale_id_tenant_id_sales_id_tenant_id_fk"
  FOREIGN KEY ("original_sale_id", "tenant_id")
  REFERENCES "sales" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint

-- Refunds are append-only and self-attributed. The unique index on
-- original_sale_id enforces the MVP rule of at most one (full-sale) refund
-- per sale; the composite FK above guarantees that refund and its original
-- sale share a tenant.
CREATE POLICY "tenant members can read refunds"
ON "refunds" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
CREATE POLICY "tenant members can insert refunds"
ON "refunds" FOR INSERT
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "user_id" = auth.uid()
);
