ALTER TABLE "products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE INDEX "products_category_id_tenant_id_idx" ON "products" USING btree ("category_id","tenant_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_tenant_id_unique" UNIQUE("id","tenant_id");