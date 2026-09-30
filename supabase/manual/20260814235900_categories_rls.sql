-- Run after the Drizzle migration that creates public.categories.
-- Categories are tenant-owned mutable catalog data.

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members can read categories" ON "categories";
CREATE POLICY "tenant members can read categories"
ON "categories" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));

DROP POLICY IF EXISTS "tenant members can insert categories" ON "categories";
CREATE POLICY "tenant members can insert categories"
ON "categories" FOR INSERT
WITH CHECK ("public"."current_user_has_tenant"("tenant_id"));

DROP POLICY IF EXISTS "tenant members can update categories" ON "categories";
CREATE POLICY "tenant members can update categories"
ON "categories" FOR UPDATE
USING ("public"."current_user_has_tenant"("tenant_id"))
WITH CHECK ("public"."current_user_has_tenant"("tenant_id"));

DROP POLICY IF EXISTS "tenant members can delete categories" ON "categories";
CREATE POLICY "tenant members can delete categories"
ON "categories" FOR DELETE
USING ("public"."current_user_has_tenant"("tenant_id"));
