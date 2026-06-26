-- Inventory movements: auth.users FK and append-only RLS.
-- Domain checks live in lib/db/schema.ts (Drizzle-generated). Drizzle cannot
-- model auth.users. Run after `npm run db:push` on each environment.

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict;

ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can read inventory movements"
ON "inventory_movements" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));

CREATE POLICY "tenant members can insert inventory movements"
ON "inventory_movements" FOR INSERT
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "user_id" = auth.uid()
);
