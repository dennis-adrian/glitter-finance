CREATE UNIQUE INDEX "inventory_movements_one_initial_per_product_idx" ON "inventory_movements" USING btree ("tenant_id","product_id") WHERE "inventory_movements"."reason" = 'initial';--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_delta_nonzero_check" CHECK ("inventory_movements"."delta" <> 0);--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sign_discipline_check" CHECK ((
        ("inventory_movements"."reason" IN ('initial', 'restock') AND "inventory_movements"."delta" > 0)
        OR ("inventory_movements"."reason" IN ('loss', 'gift') AND "inventory_movements"."delta" < 0)
        OR ("inventory_movements"."reason" = 'adjustment')
      ));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_price_cents_nonnegative_check" CHECK ("products"."price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_cost_cents_nonnegative_check" CHECK ("products"."cost_cents" IS NULL OR "products"."cost_cents" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_low_stock_threshold_nonnegative_check" CHECK ("products"."low_stock_threshold" IS NULL OR "products"."low_stock_threshold" >= 0);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_quantity_positive_check" CHECK ("sale_lines"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_unit_price_cents_nonnegative_check" CHECK ("sale_lines"."unit_price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_unit_cost_cents_nonnegative_check" CHECK ("sale_lines"."unit_cost_cents" IS NULL OR "sale_lines"."unit_cost_cents" >= 0);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_discount_cents_nonnegative_check" CHECK ("sale_lines"."line_discount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_total_cents_nonnegative_check" CHECK ("sale_lines"."line_total_cents" >= 0);--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_discount_cents_nonnegative_check" CHECK ("sales"."sale_discount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_void_coherence_check" CHECK ((
        ("sales"."voided_at" IS NULL AND "sales"."voided_by_user_id" IS NULL)
        OR ("sales"."voided_at" IS NOT NULL AND "sales"."voided_by_user_id" IS NOT NULL)
      ));