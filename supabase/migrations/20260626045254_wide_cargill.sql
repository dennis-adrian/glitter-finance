CREATE TYPE "public"."inventory_movement_reason" AS ENUM('initial', 'restock', 'adjustment', 'loss', 'gift');--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "inventory_movement_reason" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracks_inventory" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "low_stock_threshold" integer;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_tenant_id_products_id_tenant_id_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_product_idx" ON "inventory_movements" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_created_at_idx" ON "inventory_movements" USING btree ("tenant_id","created_at");