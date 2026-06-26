-- Inventory movements: auth.users FK, domain checks, and append-only RLS.
-- Drizzle cannot model auth.users; CHECK sign discipline is enforced here.

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_delta_nonzero_check" CHECK ("delta" <> 0),
  ADD CONSTRAINT "inventory_movements_sign_discipline_check" CHECK (
    ("reason" IN ('initial', 'restock') AND "delta" > 0)
    OR ("reason" IN ('loss', 'gift') AND "delta" < 0)
    OR ("reason" = 'adjustment')
  );
--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant members can read inventory movements"
ON "inventory_movements" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
CREATE POLICY "tenant members can insert inventory movements"
ON "inventory_movements" FOR INSERT
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "user_id" = auth.uid()
);
