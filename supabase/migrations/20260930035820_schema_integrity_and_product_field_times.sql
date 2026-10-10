ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_delta_nonzero_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_sign_discipline_check";--> statement-breakpoint
DROP INDEX "inventory_movements_one_initial_per_product_idx";--> statement-breakpoint
DROP INDEX "products_tenant_id_idx";--> statement-breakpoint
DROP INDEX "tenant_users_tenant_id_idx";--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "product_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "field_updated_at" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_movements_user_id_idx" ON "inventory_movements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refunds_user_id_idx" ON "refunds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sale_lines_product_id_tenant_id_idx" ON "sale_lines" USING btree ("product_id","tenant_id");--> statement-breakpoint
CREATE INDEX "sales_voided_by_user_id_idx" ON "sales" USING btree ("voided_by_user_id") WHERE "sales"."voided_by_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tenant_invitations_created_by_user_id_idx" ON "tenant_invitations" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "tenants_created_by_user_id_idx" ON "tenants" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sign_discipline_check" CHECK ((
        ("inventory_movements"."reason" = 'initial' AND "inventory_movements"."delta" >= 0)
        OR ("inventory_movements"."reason" = 'restock' AND "inventory_movements"."delta" > 0)
        OR ("inventory_movements"."reason" IN ('loss', 'gift') AND "inventory_movements"."delta" < 0)
        OR ("inventory_movements"."reason" = 'adjustment' AND "inventory_movements"."delta" <> 0)
      ));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_name_not_blank_check" CHECK (btrim("products"."name") <> '');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_not_blank_check" CHECK (btrim("products"."category") <> '');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_name_length_check" CHECK (char_length("products"."name") <= 120);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_length_check" CHECK (char_length("products"."category") <= 60);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_name_not_blank_check" CHECK (btrim("sale_lines"."product_name") <> '');--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_category_not_blank_check" CHECK (btrim("sale_lines"."category") <> '');--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_discount_within_gross_check" CHECK ("sale_lines"."line_discount_cents" <= "sale_lines"."unit_price_cents"::bigint * "sale_lines"."quantity");--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_total_coherence_check" CHECK ("sale_lines"."line_total_cents"::bigint = "sale_lines"."unit_price_cents"::bigint * "sale_lines"."quantity" - "sale_lines"."line_discount_cents");