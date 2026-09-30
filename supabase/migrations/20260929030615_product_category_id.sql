ALTER TABLE "products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE INDEX "products_tenant_category_idx" ON "products" USING btree ("tenant_id","category_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_tenant_id_unique" UNIQUE("id","tenant_id");