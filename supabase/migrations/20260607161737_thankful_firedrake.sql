ALTER TABLE "products" ADD CONSTRAINT "products_id_tenant_id_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_tenant_id_products_id_tenant_id_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE restrict ON UPDATE no action;
